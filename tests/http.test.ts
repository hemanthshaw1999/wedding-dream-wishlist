import { afterEach, describe, expect, it } from "vitest";
import { AppError } from "../src/lib/errors";
import { assertMutation, applicationOrigin, readJson } from "../src/server/http";

const oldMode = process.env.DEMO_MODE;
const oldOrigin = process.env.APP_ORIGIN;
const oldEnvironment = process.env.APP_ENV;
afterEach(() => {
  if (oldMode === undefined) delete process.env.DEMO_MODE; else process.env.DEMO_MODE = oldMode;
  if (oldOrigin === undefined) delete process.env.APP_ORIGIN; else process.env.APP_ORIGIN = oldOrigin;
  if (oldEnvironment === undefined) delete process.env.APP_ENV; else process.env.APP_ENV = oldEnvironment;
});
function enable() { process.env.DEMO_MODE = "local-only"; process.env.APP_ORIGIN = "http://127.0.0.1:4317"; }
function request(origin: string | null, host = "127.0.0.1:4317", type = "application/json") {
  return new Request("http://127.0.0.1:4317/api/owner/wishlists", {
    method: "POST", headers: { Host: host, ...(origin === null ? {} : { Origin: origin }), "Content-Type": type }, body: "{}"
  });
}
describe("local HTTP boundary", () => {
  it("fails closed without explicit demo configuration", () => {
    delete process.env.DEMO_MODE;
    expect(() => applicationOrigin()).toThrow(AppError);
    enable();
    process.env.APP_ORIGIN = "https://public.example";
    expect(() => applicationOrigin()).toThrow();
  });
  it.each([null, "null", "https://evil.example", "http://127.0.0.1:9999"])("rejects untrusted or missing Origin %s", (origin) => {
    enable();
    expect(() => assertMutation(request(origin))).toThrow("origin");
  });
  it("rejects a rebinding host and non-JSON mutation", () => {
    enable();
    expect(() => assertMutation(request("http://127.0.0.1:4317", "evil.example"))).toThrow();
    expect(() => assertMutation(request("http://127.0.0.1:4317", undefined, "text/plain"))).toThrow("application/json");
    expect(() => assertMutation(request("http://127.0.0.1:4317"))).not.toThrow();
  });
  it("rejects malformed JSON and bounded-body overflow", async () => {
    const req = (body: string) => new Request("http://127.0.0.1", { method: "POST", body });
    await expect(readJson(req("{"))).rejects.toThrow("valid JSON");
    await expect(readJson(req(JSON.stringify({ value: "x".repeat(49_000) })))).rejects.toThrow("too large");
  });
  it("uses the same exact Host/Origin checks for explicitly configured HTTPS production", () => {
    const origin = "https://wishlist.example.test";
    delete process.env.DEMO_MODE;
    process.env.APP_ENV = "production"; process.env.APP_ORIGIN = origin;
    const mutation = (origin: string, host = "wishlist.example.test") => new Request("https://wishlist.example.test/api/owner/wishlists", {
      method: "POST", headers: { Host: host, Origin: origin, "Content-Type": "application/json" }, body: "{}"
    });
    expect(() => assertMutation(mutation(origin))).not.toThrow();
    expect(() => assertMutation(mutation("https://evil.example.test"))).toThrow("origin");
    expect(() => assertMutation(mutation(origin, "evil.example.test"))).toThrow("origin");
  });
});
