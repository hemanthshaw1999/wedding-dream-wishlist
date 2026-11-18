import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { randomBytes, randomUUID } from "node:crypto";
import { openDatabase } from "../src/server/database";
import { createAuth } from "../src/server/auth";
import { enforceRateLimit } from "../src/server/http";

let db: DatabaseSync;
let auth: ReturnType<typeof createAuth>;
const origin = "http://127.0.0.1:4317";
const password = "Fictional-test-only-password!42";
const state = vi.hoisted(() => ({ db: undefined as DatabaseSync | undefined }));
vi.mock("../src/server/database.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/server/database.ts")>();
  return { ...actual, getDatabase: () => {
    if (!state.db) throw new Error("Missing test database.");
    return state.db;
  } };
});

beforeEach(() => {
  db = openDatabase(":memory:"); state.db = db;
  auth = createAuth({ database: db, origin, secret: randomBytes(48).toString("hex") });
});
afterEach(() => { db.close(); vi.useRealTimers(); });
function post(path: string, body: unknown) {
  return auth.handler(new Request(`${origin}/api/auth/${path}`, { method: "POST",
    headers: { Origin: origin, Host: "127.0.0.1:4317", "Content-Type": "application/json" }, body: JSON.stringify(body) }));
}
async function verified() {
  const email = `${randomUUID()}@example.test`;
  expect((await post("sign-up/email", { email, password, name: "Fictional owner" })).status).toBe(200);
  const entry = db.prepare("SELECT url FROM auth_local_outbox WHERE recipient=? AND kind='verification'").get(email);
  expect(entry).toBeDefined();
  const response = await auth.handler(new Request(String(entry?.url)));
  expect([200, 302]).toContain(response.status);
  const login = await post("sign-in/email", { email, password });
  expect(login.status).toBe(200);
  const cookie = login.headers.getSetCookie().map((entry) => entry.split(";")[0]).join("; ");
  return { email, cookie, login };
}
describe("real maintained authentication with local delivery adapter", () => {
  it("requires verification, hashes passwords and prevents duplicate signup enumeration", async () => {
    const body = { email: "fictional@example.test", password, name: "Fictional" };
    const initial = await post("sign-up/email", body);
    const duplicate = await post("sign-up/email", body);
    expect(initial.status).toBe(200); expect(duplicate.status).toBe(200);
    expect(Object.keys(await initial.json())).toEqual(Object.keys(await duplicate.json()));
    expect((await post("sign-in/email", { email: body.email, password })).status).toBe(403);
    const row = db.prepare("SELECT password FROM auth_accounts").get();
    expect(String(row?.password)).not.toContain(password);
    expect(String(row?.password).length).toBeGreaterThan(30);
  });
  it("authenticates with a verified account and revokes sign-out immediately", async () => {
    const { cookie, login } = await verified();
    expect(login.headers.get("set-cookie")).toContain("HttpOnly");
    expect(login.headers.get("set-cookie")?.toLowerCase()).toContain("samesite=strict");
    expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).not.toBeNull();
    const result = await auth.handler(new Request(`${origin}/api/auth/sign-out`, { method: "POST",
      headers: { cookie, Origin: origin, "Content-Type": "application/json" }, body: "{}" }));
    expect(result.status).toBe(200);
    expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
  });
  it("rejects expired persisted sessions and invented cookie values", async () => {
    const { cookie } = await verified();
    const value = db.prepare("SELECT expiresAt FROM auth_sessions").get()?.expiresAt;
    db.prepare("UPDATE auth_sessions SET expiresAt=?").run(typeof value === "number" ? Date.now() - 60_000 : new Date(Date.now() - 60_000).toISOString());
    expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
    expect(await auth.api.getSession({ headers: new Headers({ cookie: "better-auth.session_token=invented" }) })).toBeNull();
  });
  it("supports single-use recovery and revokes old sessions", async () => {
    const { email, cookie } = await verified();
    expect((await post("request-password-reset", { email, redirectTo: `${origin}/reset-password` })).status).toBe(200);
    const entry = db.prepare("SELECT url FROM auth_local_outbox WHERE recipient=? AND kind='recovery'").get(email);
    const url = new URL(String(entry?.url));
    const token = url.pathname.split("/").at(-1);
    const newPassword = `${password}-changed`;
    expect((await post("reset-password", { token, newPassword })).status).toBe(200);
    expect((await post("reset-password", { token, newPassword })).status).not.toBe(200);
    expect((await post("sign-in/email", { email, password })).status).toBe(401);
    expect((await post("sign-in/email", { email, password: newPassword })).status).toBe(200);
    expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
  });
  it("limits the server-side action bucket and allows a new window", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-18T18:00:00.000Z"));
    enforceRateLimit("create", "owner", 2);
    enforceRateLimit("create", "owner", 2);
    expect(() => enforceRateLimit("create", "owner", 2)).toThrow("Too many");
    expect(() => enforceRateLimit("create", "another-owner", 2)).not.toThrow();
    vi.advanceTimersByTime(60_001);
    expect(() => enforceRateLimit("create", "owner", 2)).not.toThrow();
  });
});
