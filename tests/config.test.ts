import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { applicationConfig, authenticationConfig, emailOutboxConfig } from "../src/server/config";

const production = { APP_ENV: "production", APP_ORIGIN: "https://wishlist.example.test" };
describe("production configuration gates", () => {
  it.each(["http://wishlist.example.test", "https://localhost", "https://127.0.0.1",
    "https://wishlist.example.test/path", "https://wishlist.example.test/", "https://user:password@wishlist.example.test"])(
    "rejects unsafe/noncanonical production origin %s", (APP_ORIGIN) => {
      expect(() => applicationConfig({ ...production, APP_ORIGIN })).toThrow();
    });
  it("refuses ambiguous modes, missing secrets and insecure public demo configuration", () => {
    expect(() => applicationConfig({ ...production, DEMO_MODE: "local-only" })).toThrow();
    expect(() => applicationConfig({ APP_ENV: "prod", APP_ORIGIN: production.APP_ORIGIN })).toThrow();
    expect(() => applicationConfig({ DEMO_MODE: "local-only", APP_ORIGIN: production.APP_ORIGIN })).toThrow();
    expect(() => authenticationConfig(production)).toThrow();
    expect(() => authenticationConfig({ ...production, BETTER_AUTH_SECRET: "placeholder" })).toThrow();
    expect(authenticationConfig({ ...production, BETTER_AUTH_SECRET: randomBytes(48).toString("hex") }).mode).toBe("production");
  });
  it("requires independent encryption, verified sender and explicit provider authorization", () => {
    const config = { ...production, EMAIL_DELIVERY_APPROVED: "resend-free", EMAIL_FROM: "accounts@example.test",
      EMAIL_SENDER_VERIFIED: "yes", EMAIL_OUTBOX_KEY: randomBytes(32).toString("hex") };
    expect(() => emailOutboxConfig(production)).toThrow();
    expect(() => emailOutboxConfig({ ...config, EMAIL_SENDER_VERIFIED: undefined })).toThrow();
    expect(() => emailOutboxConfig({ ...config, EMAIL_FROM: "accounts@example.test\r\nBcc: other@example.test" })).toThrow();
    expect(() => emailOutboxConfig({ ...config, EMAIL_OUTBOX_KEY: "short" })).toThrow();
    expect(emailOutboxConfig(config).key).toHaveLength(32);
  });
  it.each([["scripts/send-email.ts", "auth_email_worker_failed"], ["scripts/run-production.ts", "production_start_failed"]])(
    "keeps %s disabled without provider authorization, without opening a DB or printing private details", async (script, event) => {
      await expect(promisify(execFile)(process.execPath, ["--experimental-strip-types", script], {
        env: { ...process.env, ...production, DEMO_MODE: undefined, BETTER_AUTH_SECRET: randomBytes(48).toString("hex"),
          EMAIL_DELIVERY_APPROVED: undefined, DATABASE_URL: "invalid-database-must-not-be-opened" }, timeout: 10000
      })).rejects.toMatchObject({ code: 1, stdout: "", stderr: expect.stringContaining(`"event":"${event}"`) });
    });
});
