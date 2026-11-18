import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from "node:crypto";
import { isEmailAddress } from "./config.ts";
import type { Database } from "./database.ts";

type Kind = "verification" | "recovery";
type Envelope = { from: string; to: string; subject: string; text: string };
export type EmailQueueConfig = { origin: string; key: Buffer; from: string };
type ErrorClass = "network" | "provider" | "rejected" | "invalid_response" | "invalid_payload";
type Job = {
  id: string; kind: Kind; payload: Buffer; expires_at: Date; attempts: number; lease_token: string; uncertain: boolean; state: "queued" | "leased";
};
type Result = { accepted: true; providerId: string } |
  { accepted: false; retry: boolean; uncertain: boolean; errorClass: ErrorClass };
const maxAttempts = 5;

function checkKey(key: Buffer) {
  if (key.length !== 32) throw new Error("Email encryption needs an independent 256-bit key.");
}

export async function enqueueAuthEmail(db: Database, config: EmailQueueConfig, recipient: string, url: string, kind: Kind) {
  checkKey(config.key);
  const link = new URL(url);
  const validPath = kind === "verification" ? link.pathname === "/api/auth/verify-email" :
    /^\/api\/auth\/reset-password\/[^/]+$/.test(link.pathname);
  if (!isEmailAddress(config.from) || !isEmailAddress(recipient) || link.origin !== config.origin ||
      link.username || link.password || link.hash || !validPath) throw new Error("Invalid authentication email envelope.");
  const now = new Date();
  const expires = new Date(now.getTime() + (kind === "verification" ? 25 : 10) * 60_000);
  const id = randomUUID();
  const payload: Envelope = {
    from: config.from, to: recipient,
    subject: kind === "verification" ? "Verify your Wedding Dream Wishlist account" : "Reset your Wedding Dream Wishlist password",
    text: `${kind === "verification" ? "Verify your account" : "Reset your password"}:\n${link.href}\n\nIf you did not request this, ignore this message. Never share this private link.`
  };
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", config.key, iv);
  cipher.setAAD(Buffer.from(`${id}:${kind}:${expires.toISOString()}`));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const sealed = Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
  const dedup = createHmac("sha256", config.key).update(`${kind}\0${recipient}\0${url}`).digest("hex");
  await db.run(`INSERT INTO auth_email_outbox(id,dedup_key,kind,payload,expires_at,created_at,available_at,state)
    VALUES($1,$2,$3,$4,$5,$6,$6,'queued') ON CONFLICT(dedup_key) DO NOTHING`, [id, dedup, kind, sealed, expires, now]);
}

function decrypt(job: Job, key: Buffer): Envelope {
  const decipher = createDecipheriv("aes-256-gcm", key, job.payload.subarray(0, 12));
  decipher.setAAD(Buffer.from(`${job.id}:${job.kind}:${job.expires_at.toISOString()}`));
  decipher.setAuthTag(job.payload.subarray(12, 28));
  const value: unknown = JSON.parse(Buffer.concat([decipher.update(job.payload.subarray(28)), decipher.final()]).toString("utf8"));
  if (!value || typeof value !== "object" || !("from" in value) || typeof value.from !== "string" ||
      !("to" in value) || typeof value.to !== "string" || !("subject" in value) || typeof value.subject !== "string" ||
      !("text" in value) || typeof value.text !== "string" || !isEmailAddress(value.from) || !isEmailAddress(value.to)) {
    throw new Error("Invalid encrypted email payload.");
  }
  return { from: value.from, to: value.to, subject: value.subject, text: value.text };
}

async function submit(envelope: Envelope, id: string, apiKey: string, fetcher: typeof fetch): Promise<Result> {
  let response: Response;
  try {
    response = await fetcher("https://api.resend.com/emails", {
      method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": `auth/${id}` },
      body: JSON.stringify(envelope)
    });
  } catch {
    return { accepted: false, retry: true, uncertain: true, errorClass: "network" };
  }
  if (!response.ok) {
    try { await response.body?.cancel(); }
    catch { return { accepted: false, retry: true, uncertain: true, errorClass: "network" }; }
    const retry = response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500;
    return { accepted: false, retry, uncertain: response.status >= 500 || response.status === 408, errorClass: retry ? "provider" : "rejected" };
  }
  try {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Missing provider acknowledgement.");
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 4096) { await reader.cancel(); throw new Error("Oversized acknowledgement."); }
      chunks.push(value);
    }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (body && typeof body === "object" && "id" in body && typeof body.id === "string" &&
        /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(body.id)) return { accepted: true, providerId: body.id };
  } catch {
    return { accepted: false, retry: true, uncertain: true, errorClass: "invalid_response" };
  }
  return { accepted: false, retry: true, uncertain: true, errorClass: "invalid_response" };
}

export async function dispatchAuthEmail(db: Database, options: {
  key: Buffer; apiKey: string; fetcher?: typeof fetch; dailyLimit?: number; monthlyLimit?: number;
}) {
  checkKey(options.key);
  if (!options.apiKey || /[\s\r\n]/.test(options.apiKey)) throw new Error("A server-only provider credential is required.");
  const dailyLimit = options.dailyLimit ?? 90;
  const monthlyLimit = options.monthlyLimit ?? 2700;
  if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 90 ||
      !Number.isInteger(monthlyLimit) || monthlyLimit < 1 || monthlyLimit > 2700) throw new Error("Email free-tier safety budgets cannot be increased.");
  const now = new Date();
  const lease = await db.transaction(async (tx) => {
    await tx.run("SELECT pg_advisory_xact_lock(hashtext('auth-email-budget'))");
    await tx.run(`UPDATE auth_email_outbox SET state='expired',payload=NULL,lease_token=NULL,lease_until=NULL
      WHERE state IN ('queued','leased') AND expires_at<=$1 AND (lease_until IS NULL OR lease_until<=$1)`, [now]);
    await tx.run(`UPDATE auth_email_outbox SET state='unknown',payload=NULL,lease_token=NULL,lease_until=NULL
      WHERE state='leased' AND lease_until<=$1 AND attempts=$2`, [now, maxAttempts]);
    await tx.run("DELETE FROM auth_email_outbox WHERE state NOT IN ('queued','leased') AND created_at<$1", [new Date(now.getTime() - 7 * 86400_000)]);
    await tx.run("DELETE FROM auth_email_budgets WHERE expires_at<$1", [now]);
    const job = await tx.get<Job>(`SELECT id,kind,payload,expires_at,attempts,lease_token,uncertain,state FROM auth_email_outbox
      WHERE expires_at>$1 AND available_at<=$2 AND attempts<$3 AND (state='queued' OR (state='leased' AND lease_until<=$2))
      ORDER BY available_at,id FOR UPDATE SKIP LOCKED LIMIT 1`, [new Date(now.getTime() + 15_000), now, maxAttempts]);
    if (!job) return { state: "empty" as const };
    const budgets = [[`day:${now.toISOString().slice(0, 10)}`, dailyLimit], [`month:${now.toISOString().slice(0, 7)}`, monthlyLimit]] as const;
    for (const [period, limit] of budgets) {
      const budget = await tx.get("SELECT attempts FROM auth_email_budgets WHERE period=$1", [period]);
      if (Number(budget?.attempts ?? 0) >= limit) return { state: "quota" as const };
    }
    for (const [period] of budgets) await tx.run(`INSERT INTO auth_email_budgets VALUES($1,1,$2)
      ON CONFLICT(period) DO UPDATE SET attempts=auth_email_budgets.attempts+1`, [period, new Date(now.getTime() + 40 * 86400_000)]);
    job.uncertain ||= job.state === "leased";
    job.lease_token = randomUUID(); job.attempts++;
    await tx.run(`UPDATE auth_email_outbox SET state='leased',attempts=$2,lease_token=$3,lease_until=$4,uncertain=$5 WHERE id=$1`,
      [job.id, job.attempts, job.lease_token, new Date(now.getTime() + 60_000), job.uncertain]);
    return { state: "leased" as const, job };
  });
  if (lease.state !== "leased") return lease.state;
  const job = lease.job;
  let envelope: Envelope | undefined;
  try {
    envelope = decrypt(job, options.key);
  } catch {
    console.error(JSON.stringify({ event: "auth_email_payload_invalid", correlationId: job.id }));
  }
  const result: Result = envelope ? await submit(envelope, job.id, options.apiKey, options.fetcher ?? fetch) :
    { accepted: false, retry: false, uncertain: false, errorClass: "invalid_payload" };
  const uncertain = job.uncertain || (!result.accepted && result.uncertain);
  const state = result.accepted ? "accepted" : result.retry && job.attempts < maxAttempts ? "queued" : uncertain ? "unknown" : "failed";
  const completed = await db.get(`UPDATE auth_email_outbox SET state=$3,payload=CASE WHEN $3='queued' THEN payload ELSE NULL END,
    lease_token=NULL,lease_until=NULL,available_at=$4,provider_id=$5,error_class=$6,uncertain=$7 WHERE id=$1 AND lease_token=$2 AND state='leased' RETURNING id`,
    [job.id, job.lease_token, state, new Date(Date.now() + Math.min(60_000 * 2 ** (job.attempts - 1), 600_000)),
      result.accepted ? result.providerId : null, result.accepted ? null : result.errorClass, uncertain]);
  return !completed ? "lease_lost" : state === "queued" ? "retry" : state;
}
