import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuth } from "../src/server/auth";
import { openDatabase, type Database } from "../src/server/database";
import { dispatchAuthEmail, enqueueAuthEmail } from "../src/server/email";
import { createTestDatabase } from "./db-fixture";

let fixture: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Database;
const origin = "https://wishlist.example.test";
const from = "accounts@example.test";
const recipient = "fictional@example.test";
const privateUrl = `${origin}/api/auth/verify-email?token=fictional-private-token`;
const providerId = randomUUID();
let key: Buffer;
beforeEach(async () => {
  fixture = await createTestDatabase({ restrictedRuntime: true });
  db = openDatabase(fixture.runtimeUrl, ["test"]);
  key = randomBytes(32);
});
afterEach(async () => { vi.useRealTimers(); await db.close(); await fixture.cleanup(); });
const accepted = () => Response.json({ id: providerId });
const transport = () => vi.fn<typeof fetch>(async () => accepted());
async function enqueue(url = privateUrl) {
  await enqueueAuthEmail(db, { origin, from, key }, recipient, url, "verification");
}
function freeze() { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-20T12:00:00Z")); }

describe("encrypted authentication outbox with real PostgreSQL and a local provider fixture", () => {
  it("encrypts private addresses/links and deduplicates concurrent enqueue operations", async () => {
    await Promise.all(Array.from({ length: 8 }, () => enqueue()));
    const rows = await db.all("SELECT * FROM auth_email_outbox");
    expect(rows).toHaveLength(1);
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain(recipient); expect(serialized).not.toContain("fictional-private-token");
    expect((await db.all("SELECT * FROM auth_local_outbox"))).toHaveLength(0);
    await expect(enqueue("https://wishlist.example.test.evil.test/api/auth/verify-email?token=x")).rejects.toThrow("envelope");
    await expect(enqueue(`${origin}/arbitrary?token=x`)).rejects.toThrow("envelope");
  });
  it("leases once across concurrent workers and wipes private payload after provider acknowledgement", async () => {
    await enqueue();
    const fetcher = transport();
    const result = await Promise.all([0, 1, 2].map(() => dispatchAuthEmail(db, { key, apiKey: "fixture-not-a-secret", fetcher })));
    expect(result.filter((value) => value === "accepted")).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, request] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails"); expect(request?.redirect).toBe("error");
    const payload = JSON.parse(String(request?.body));
    expect(payload).toEqual({ from, to: recipient, subject: expect.any(String), text: expect.stringContaining(privateUrl) });
    expect(await db.get("SELECT state,payload,provider_id FROM auth_email_outbox")).toEqual({ state: "accepted", payload: null, provider_id: providerId });
  });
  it("retries an unknown acknowledgement with an unchanged provider key/body and conservative budgets", async () => {
    freeze(); await enqueue();
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("Fixture simulates lost acknowledgement")).mockResolvedValueOnce(accepted());
    expect(await dispatchAuthEmail(db, { key, apiKey: "fixture-not-a-secret", fetcher })).toBe("retry");
    expect(await dispatchAuthEmail(db, { key, apiKey: "fixture-not-a-secret", fetcher })).toBe("empty");
    vi.setSystemTime(new Date(Date.now() + 61_000));
    expect(await dispatchAuthEmail(db, { key, apiKey: "fixture-not-a-secret", fetcher })).toBe("accepted");
    expect(fetcher.mock.calls[0][1]?.body).toBe(fetcher.mock.calls[1][1]?.body);
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get("Idempotency-Key")).toBe(new Headers(fetcher.mock.calls[1][1]?.headers).get("Idempotency-Key"));
    expect((await db.all("SELECT attempts FROM auth_email_budgets")).map((row) => row.attempts)).toEqual([2, 2]);
  });
  it("recovers a crashed worker lease and fences an obsolete acknowledgement", async () => {
    await enqueue();
    await db.run(`UPDATE auth_email_outbox SET state='leased',attempts=1,lease_token=$1,lease_until=$2`, [randomUUID(), new Date(Date.now() - 1000)]);
    const fetcher = vi.fn<typeof fetch>(async () => {
      await db.run("UPDATE auth_email_outbox SET lease_token=$1", [randomUUID()]);
      return accepted();
    });
    expect(await dispatchAuthEmail(db, { key, apiKey: "fixture-not-a-secret", fetcher })).toBe("lease_lost");
    expect((await db.get("SELECT state,uncertain,attempts FROM auth_email_outbox"))).toEqual({ state: "leased", uncertain: true, attempts: 2 });
  });
  it("enforces daily/monthly attempt budgets atomically rather than silently increasing spend", async () => {
    freeze();
    await Promise.all([0, 1, 2].map((id) => enqueue(`${privateUrl}-${id}`)));
    const fetcher = transport();
    const options = { key, apiKey: "fixture-not-a-secret", fetcher, dailyLimit: 1, monthlyLimit: 1 };
    const result = await Promise.all([0, 1, 2].map(() => dispatchAuthEmail(db, options)));
    expect(result.filter((value) => value === "accepted")).toHaveLength(1);
    expect(result.filter((value) => value === "quota")).toHaveLength(2);
    vi.setSystemTime(new Date(Date.now() + 86400_000));
    await enqueue(`${privateUrl}-tomorrow`);
    expect(await dispatchAuthEmail(db, options)).toBe("quota");
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(dispatchAuthEmail(db, { ...options, dailyLimit: 101 })).rejects.toThrow("budgets");
  });
  it.each([[401, "failed"], [429, "retry"], [503, "retry"]] as const)("handles provider HTTP %s as %s, not success", async (status, outcome) => {
    await enqueue();
    const fetcher = vi.fn<typeof fetch>(async () => new Response("Fixture response withheld", { status }));
    expect(await dispatchAuthEmail(db, { key, apiKey: "fixture-not-a-secret", fetcher })).toBe(outcome);
    expect((await db.get("SELECT provider_id FROM auth_email_outbox"))?.provider_id).toBeNull();
  });
  it("does not mistake malformed success or exhausted unknown outcomes for delivery", async () => {
    await enqueue();
    await db.run("UPDATE auth_email_outbox SET attempts=4");
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ success: true }));
    expect(await dispatchAuthEmail(db, { key, apiKey: "fixture-not-a-secret", fetcher })).toBe("unknown");
    expect(await db.get("SELECT state,payload,error_class FROM auth_email_outbox")).toEqual({ state: "unknown", payload: null, error_class: "invalid_response" });
  });
  it("expires credentials without sending and rejects ciphertext tampering", async () => {
    freeze(); await enqueue();
    vi.setSystemTime(new Date(Date.now() + 26 * 60_000));
    const fetcher = transport();
    expect(await dispatchAuthEmail(db, { key, apiKey: "fixture-not-a-secret", fetcher })).toBe("empty");
    expect(await db.get("SELECT state,payload FROM auth_email_outbox")).toEqual({ state: "expired", payload: null });
    await enqueue(`${privateUrl}-new`);
    await db.run("UPDATE auth_email_outbox SET payload=$1 WHERE state='queued'", [Buffer.alloc(64)]);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try { expect(await dispatchAuthEmail(db, { key, apiKey: "fixture-not-a-secret", fetcher })).toBe("failed"); }
    finally { log.mockRestore(); }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("runs real HTTPS signup, private queued verification and Secure session creation without sending email", async () => {
    expect(() => createAuth({ database: db, origin, secret: randomBytes(48).toString("hex") })).toThrow("delivery adapter");
    const auth = createAuth({ database: db, origin, secret: randomBytes(48).toString("hex"),
      deliver: (to, url, kind) => enqueueAuthEmail(db, { origin, from, key }, to, url, kind) });
    const password = "Fictional-HTTPS-fixture-only!42";
    const post = (path: string, body: unknown) => auth.handler(new Request(`${origin}/api/auth/${path}`, {
      method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body)
    }));
    expect((await post("sign-up/email", { email: recipient, name: "Fictional owner", password })).status).toBe(200);
    expect((await post("sign-in/email", { email: recipient, password })).status).toBe(403);
    const fetcher = transport();
    expect(await dispatchAuthEmail(db, { key, apiKey: "fixture-not-a-secret", fetcher })).toBe("accepted");
    const payload = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    const link = String(payload.text).match(/https:\/\/\S+/)?.[0];
    expect(link).toBeDefined();
    expect([200, 302]).toContain((await auth.handler(new Request(String(link)))).status);
    const login = await post("sign-in/email", { email: recipient, password });
    expect(login.status).toBe(200);
    const cookies = login.headers.get("set-cookie");
    expect(cookies).toContain("Secure"); expect(cookies).toContain("HttpOnly");
    expect(cookies?.toLowerCase()).toContain("samesite=strict");
    const cookie = login.headers.getSetCookie().map((entry) => entry.split(";")[0]).join("; ");
    expect((await post("request-password-reset", { email: recipient, redirectTo: `${origin}/reset-password` })).status).toBe(200);
    expect(await dispatchAuthEmail(db, { key, apiKey: "fixture-not-a-secret", fetcher })).toBe("accepted");
    const recoveryPayload = JSON.parse(String(fetcher.mock.calls[1][1]?.body));
    const recoveryLink = String(recoveryPayload.text).match(/https:\/\/\S+/)?.[0];
    expect(recoveryLink).toBeDefined();
    const token = new URL(String(recoveryLink)).pathname.split("/").at(-1);
    expect((await post("reset-password", { token, newPassword: `${password}-changed` })).status).toBe(200);
    expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
    expect((await post("reset-password", { token, newPassword: `${password}-changed` })).status).not.toBe(200);
    expect((await db.all("SELECT * FROM auth_local_outbox"))).toHaveLength(0);
  });
});
