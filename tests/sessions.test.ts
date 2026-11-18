import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../src/server/database";
import { randomBytes, randomUUID } from "node:crypto";
import { createAuth } from "../src/server/auth";
import { enforceRateLimit } from "../src/server/http";
import { createTestDatabase } from "./db-fixture";

let fixture: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Database;
let auth: ReturnType<typeof createAuth>;
const origin = "http://127.0.0.1:4317";
const password = "Fictional-test-only-password!42";
const state = vi.hoisted(() => ({ db: undefined as Database | undefined }));
vi.mock("../src/server/database.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/server/database.ts")>();
  return { ...actual, getDatabase: () => {
    if (!state.db) throw new Error("Missing test database.");
    return state.db;
  } };
});

beforeEach(async () => {
  fixture = await createTestDatabase(); db = fixture.db; state.db = db;
  auth = createAuth({ database: db, origin, secret: randomBytes(48).toString("hex") });
});
afterEach(async () => { vi.useRealTimers(); await fixture.cleanup(); });
function post(path: string, body: unknown) {
  return auth.handler(new Request(`${origin}/api/auth/${path}`, { method: "POST",
    headers: { Origin: origin, Host: "127.0.0.1:4317", "Content-Type": "application/json" }, body: JSON.stringify(body) }));
}
async function verified() {
  const email = `${randomUUID()}@example.test`;
  expect((await post("sign-up/email", { email, password, name: "Fictional owner" })).status).toBe(200);
  const entry = await db.get("SELECT url FROM auth_local_outbox WHERE recipient=$1 AND kind='verification'", [email]);
  expect(entry).toBeDefined();
  const response = await auth.handler(new Request(String(entry?.url)));
  expect([200, 302]).toContain(response.status);
  const login = await post("sign-in/email", { email, password });
  expect(login.status).toBe(200);
  const cookie = login.headers.getSetCookie().map((entry) => entry.split(";")[0]).join("; ");
  return { email, cookie, login };
}
describe("maintained authentication with PostgreSQL and local delivery", () => {
  it("requires verification, hashes passwords and prevents duplicate signup enumeration", async () => {
    const body = { email: "fictional@example.test", password, name: "Fictional" };
    const initial = await post("sign-up/email", body);
    const duplicate = await post("sign-up/email", body);
    expect(initial.status).toBe(200); expect(duplicate.status).toBe(200);
    expect(Object.keys(await initial.json())).toEqual(Object.keys(await duplicate.json()));
    expect((await post("sign-in/email", { email: body.email, password })).status).toBe(403);
    const row = await db.get("SELECT password FROM auth_accounts");
    expect(String(row?.password)).not.toContain(password); expect(String(row?.password).length).toBeGreaterThan(30);
  });
  it("authenticates verified accounts and immediately revokes sign-out", async () => {
    const { cookie, login } = await verified();
    expect(login.headers.get("set-cookie")).toContain("HttpOnly");
    expect(login.headers.get("set-cookie")?.toLowerCase()).toContain("samesite=strict");
    expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).not.toBeNull();
    const result = await auth.handler(new Request(`${origin}/api/auth/sign-out`, { method: "POST",
      headers: { cookie, Origin: origin, "Content-Type": "application/json" }, body: "{}" }));
    expect(result.status).toBe(200);
    expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
  });
  it("rejects expired persisted sessions and invented cookies", async () => {
    const { cookie } = await verified();
    await db.run('UPDATE auth_sessions SET "expiresAt"=$1', [new Date(Date.now() - 60_000)]);
    expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
    expect(await auth.api.getSession({ headers: new Headers({ cookie: "better-auth.session_token=invented" }) })).toBeNull();
  });
  it("supports single-use recovery and revokes existing sessions", async () => {
    const { email, cookie } = await verified();
    expect((await post("request-password-reset", { email, redirectTo: `${origin}/reset-password` })).status).toBe(200);
    const entry = await db.get("SELECT url FROM auth_local_outbox WHERE recipient=$1 AND kind='recovery'", [email]);
    const token = new URL(String(entry?.url)).pathname.split("/").at(-1);
    const newPassword = `${password}-changed`;
    expect((await post("reset-password", { token, newPassword })).status).toBe(200);
    expect((await post("reset-password", { token, newPassword })).status).not.toBe(200);
    expect((await post("sign-in/email", { email, password })).status).toBe(401);
    expect((await post("sign-in/email", { email, password: newPassword })).status).toBe(200);
    expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
  });
  it("enforces an atomic rate bucket across simultaneous requests", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-18T18:00:00.000Z"));
    const results = await Promise.allSettled([0, 1, 2].map(() => enforceRateLimit("create", "owner", 2)));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    await expect(enforceRateLimit("create", "another-owner", 2)).resolves.toBeUndefined();
    vi.setSystemTime(new Date("2026-11-18T18:01:01.000Z"));
    await expect(enforceRateLimit("create", "owner", 2)).resolves.toBeUndefined();
  });
});
