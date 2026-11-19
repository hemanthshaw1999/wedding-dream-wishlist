import { createHash, randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { AppError } from "../lib/errors.ts";
import { getDatabase } from "./database.ts";
import { getAuth } from "./auth.ts";
import { applicationConfig } from "./config.ts";

export function applicationOrigin(): string {
  try {
    return applicationConfig().origin;
  } catch {
    throw new AppError(503, "APPLICATION_DISABLED", "The application is not configured for this environment.");
  }
}

export function assertMutation(request: Request) {
  const origin = applicationOrigin();
  if (request.headers.get("host") !== new URL(origin).host || request.headers.get("origin") !== origin) {
    throw new AppError(403, "ORIGIN_DENIED", "Request origin is not allowed.");
  }
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    throw new AppError(415, "JSON_REQUIRED", "Send application/json.");
  }
}

export async function readJson(request: Request): Promise<unknown> {
  const maxBytes = 48_000;
  if (Number(request.headers.get("content-length")) > maxBytes) throw new AppError(413, "BODY_TOO_LARGE", "Request is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new AppError(400, "INVALID_JSON", "A JSON body is required.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > maxBytes) { await reader.cancel(); throw new AppError(413, "BODY_TOO_LARGE", "Request is too large."); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new AppError(400, "INVALID_JSON", "Request is not valid JSON."); }
}

export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function requireOwner(): Promise<string> {
  applicationOrigin();
  const session = await (await getAuth()).api.getSession({ headers: await headers() });
  if (!session || !session.user.emailVerified) throw new AppError(401, "SESSION_REQUIRED", "Sign in with a verified account. Unsaved fields remain in this tab.");
  await getDatabase().run("INSERT INTO users VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING",
    [session.user.id, applicationConfig().mode === "production" ? "account" : "fictional-demo", new Date().toISOString()]);
  return session.user.id;
}

// Payment-recipient changes additionally require a recently authenticated session,
// so an unattended older session cannot silently switch where guests send money.
export async function requireRecentOwner(maxAgeMs = 600_000): Promise<string> {
  applicationOrigin();
  const session = await (await getAuth()).api.getSession({ headers: await headers() });
  if (!session || !session.user.emailVerified) throw new AppError(401, "SESSION_REQUIRED", "Sign in with a verified account. Unsaved fields remain in this tab.");
  const signedInAt = new Date(session.session.createdAt).getTime();
  if (!Number.isFinite(signedInAt) || Date.now() - signedInAt > maxAgeMs) {
    throw new AppError(403, "REAUTH_REQUIRED", "Payment setup needs a fresh sign-in (within the last 10 minutes). Sign in again, then retry. Nothing was changed.");
  }
  await getDatabase().run("INSERT INTO users VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING",
    [session.user.id, applicationConfig().mode === "production" ? "account" : "fictional-demo", new Date().toISOString()]);
  return session.user.id;
}

export async function enforceRateLimit(action: string, actor: string, max: number, periodMs = 60_000): Promise<void> {
  const db = getDatabase();
  const now = Date.now();
  const bucket = tokenHash(`${action}:${actor}:${Math.floor(now / periodMs)}`);
  await db.run("DELETE FROM rate_limits WHERE expires_at<$1", [now]);
  const result = await db.get(`INSERT INTO rate_limits VALUES($1,1,$2) ON CONFLICT(bucket)
    DO UPDATE SET count=rate_limits.count+1 RETURNING count`, [bucket, now + periodMs]);
  if (Number(result?.count) > max) throw new AppError(429, "RATE_LIMITED", "Too many actions. Wait a minute before retrying.");
}

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function apiError(error: unknown): NextResponse {
  if (error instanceof AppError) {
    const response = json({ error: { code: error.code, message: error.message, fields: error.fields } }, error.status);
    if (error.status === 429) response.headers.set("Retry-After", "60");
    return response;
  }
  const correlationId = randomUUID();
  console.error(JSON.stringify({ event: "request_failed", correlationId }));
  return json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong. Retry safely.", correlationId } }, 500);
}
