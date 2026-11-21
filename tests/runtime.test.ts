import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type Database } from "../src/server/database";
import { assertApplicationReady, assertDatabaseReady } from "../src/server/readiness";
import { enqueueAuthEmail } from "../src/server/email";
import { runEmailWorker } from "../src/server/email-worker";
import scheduledEmail from "../deploy/mail-worker/functions/auth-email";
import { createTestDatabase } from "./db-fixture";

let fixture: Awaited<ReturnType<typeof createTestDatabase>>;
let opened: Database[];
let env: Record<string, string>;
beforeEach(async () => {
  fixture = await createTestDatabase({ restrictedRuntime: "email" }); opened = [];
  env = { APP_ENV: "production", APP_ORIGIN: "https://wishlist.example.test", EMAIL_FROM: "accounts@example.test",
    EMAIL_DELIVERY_APPROVED: "resend-free", EMAIL_SENDER_VERIFIED: "yes", EMAIL_OUTBOX_KEY: randomBytes(32).toString("hex"),
    DATABASE_URL: fixture.runtimeUrl, RESEND_API_KEY: "fixture-not-a-real-provider-key" };
});
afterEach(async () => {
  vi.unstubAllEnvs(); vi.restoreAllMocks();
  for (const db of opened) if (!db.pool.ended) await db.close();
  await fixture.cleanup();
});
function connect(url = fixture.runtimeUrl) {
  const db = openDatabase(url, ["test"]); opened.push(db); return db;
}

describe("production runtime boundaries with isolated PostgreSQL and mocked mail", () => {
  it("fails approval/credential gates before constructing a database or contacting a provider", async () => {
    const createDatabase = vi.fn(() => connect());
    const fetcher = vi.fn<typeof fetch>();
    for (const missing of ["EMAIL_DELIVERY_APPROVED", "EMAIL_SENDER_VERIFIED", "EMAIL_OUTBOX_KEY", "DATABASE_URL", "RESEND_API_KEY"]) {
      await expect(runEmailWorker({ env: { ...env, [missing]: "" }, createDatabase, fetcher })).rejects.toThrow();
    }
    expect(createDatabase).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
    const database = connect();
    const query = vi.spyOn(database, "get");
    await expect(assertApplicationReady(database, { ...env, BETTER_AUTH_SECRET: "unconfigured-placeholder" })).rejects.toThrow("authentication secret");
    expect(query).not.toHaveBeenCalled();
  });

  it("sends one encrypted queued job with an email-only role, no auth signing secret, and closes its pool", async () => {
    const key = Buffer.from(env.EMAIL_OUTBOX_KEY, "hex");
    await enqueueAuthEmail(fixture.db, { origin: env.APP_ORIGIN, from: env.EMAIL_FROM, key },
      "fixture@example.test", `${env.APP_ORIGIN}/api/auth/verify-email?token=fictional-private-token`, "verification");
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ id: randomUUID() }));
    expect(await runEmailWorker({ env, createDatabase: connect, fetcher })).toBe("accepted");
    expect(fetcher).toHaveBeenCalledTimes(1); expect(opened[0].pool.ended).toBe(true);
    expect((await fixture.db.get("SELECT payload FROM auth_email_outbox"))?.payload).toBeNull();
    const runtime = connect();
    await expect(runtime.run("SELECT * FROM auth_users")).rejects.toThrow("permission denied");
    await expect(runtime.run("UPDATE wishlists SET version=version+1")).rejects.toThrow("permission denied");
    await expect(assertApplicationReady(runtime, { ...env, BETTER_AUTH_SECRET: randomBytes(48).toString("hex") })).rejects.toThrow("grants are incomplete");
  });

  it("rejects broad web-role permissions and environment mismatches without sending", async () => {
    const web = await createTestDatabase({ restrictedRuntime: true });
    const fetcher = vi.fn<typeof fetch>();
    try {
      await expect(runEmailWorker({ env: { ...env, DATABASE_URL: web.runtimeUrl }, createDatabase: connect, fetcher })).rejects.toThrow("email-only");
      expect(opened[0].pool.ended).toBe(true);
      await expect(runEmailWorker({ env, fetcher })).rejects.toThrow("environment");
      expect(fetcher).not.toHaveBeenCalled();
    } finally { await web.cleanup(); }
  });

  it("checks real schema/liveness and required web grants, not just a responding home page", async () => {
    const web = await createTestDatabase({ restrictedRuntime: true });
    const runtime = connect(web.runtimeUrl);
    try {
      const webEnv = { ...env, BETTER_AUTH_SECRET: randomBytes(48).toString("hex") };
      await expect(assertApplicationReady(runtime, webEnv)).resolves.toBeUndefined();
      const role = new URL(web.runtimeUrl).username;
      expect(role).toMatch(/^wishlist_runtime_[a-f0-9]{24}$/);
      await web.db.run(`REVOKE INSERT ON goals FROM "${role}"`);
      await expect(assertApplicationReady(runtime, webEnv)).rejects.toThrow("grants are incomplete");
      await web.db.run("DELETE FROM schema_migrations WHERE version=(SELECT max(version) FROM schema_migrations)");
      await expect(assertDatabaseReady(runtime)).rejects.toThrow("migrations");
      const fresh = connect(web.runtimeUrl);
      await expect(fresh.ready()).rejects.toThrow("migrations");
      await fresh.close();
      await expect(assertDatabaseReady(fresh)).rejects.toThrow();
    } finally { await runtime.close(); await web.cleanup(); }
  });

  it("reports scheduled-function failures without private configuration or exception text", async () => {
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    vi.stubEnv("EMAIL_DELIVERY_APPROVED", "");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(scheduledEmail()).rejects.toThrow("private details are withheld");
    expect(JSON.stringify(error.mock.calls)).not.toContain(env.DATABASE_URL);
    expect(JSON.stringify(error.mock.calls)).not.toContain(env.EMAIL_OUTBOX_KEY);
    expect(JSON.stringify(error.mock.calls)).not.toContain(env.RESEND_API_KEY);
    expect(error).toHaveBeenCalledWith(JSON.stringify({ event: "auth_email_worker_failed" }));
  });
});
