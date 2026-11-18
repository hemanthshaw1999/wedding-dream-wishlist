import { createHash, randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { AppError } from "../lib/errors.ts";
import { getDatabase } from "./database.ts";
import { getAuth } from "./auth.ts";

export function localOrigin(): string {
  const origin = process.env.APP_ORIGIN;
  if (process.env.DEMO_MODE !== "local-only" || !origin || !/^http:\/\/127\.0\.0\.1:\d{4,5}$/.test(origin)) {
    throw new AppError(503, "DEMO_DISABLED", "This application is available only in explicitly enabled local demo mode.");
  }
  return origin;
}

export function assertMutation(request: Request) {
  const origin = localOrigin();
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
  localOrigin();
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session || !session.user.emailVerified) throw new AppError(401, "SESSION_REQUIRED", "Sign in with a verified local test account. Unsaved fields remain in this tab.");
  getDatabase().prepare("INSERT OR IGNORE INTO users VALUES(?,'fictional-demo',?)").run(session.user.id, new Date().toISOString());
  return session.user.id;
}

export function enforceRateLimit(action: string, actor: string, max: number, periodMs = 60_000): void {
  const db = getDatabase();
  const now = Date.now();
  const bucket = tokenHash(`${action}:${actor}:${Math.floor(now / periodMs)}`);
  db.prepare("DELETE FROM rate_limits WHERE expires_at<?").run(now);
  const result = db.prepare(`INSERT INTO rate_limits VALUES(?,1,?) ON CONFLICT(bucket)
    DO UPDATE SET count=count+1 RETURNING count`).get(bucket, now + periodMs);
  if (Number(result?.count) > max) throw new AppError(429, "RATE_LIMITED", "Too many demo actions. Wait a minute before retrying.");
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
