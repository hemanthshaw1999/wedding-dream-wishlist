import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../src/proxy";

afterEach(() => vi.unstubAllEnvs());
function configure(mode: "demo" | "production", nodeEnvironment: "development" | "production") {
  const origin = mode === "demo" ? "http://127.0.0.1:4317" : "https://wishlist.example.test";
  vi.stubEnv("APP_ORIGIN", origin); vi.stubEnv("APP_ENV", mode === "demo" ? "development" : "production");
  vi.stubEnv("DEMO_MODE", mode === "demo" ? "local-only" : undefined); vi.stubEnv("NODE_ENV", nodeEnvironment);
  return () => proxy(new NextRequest(origin, { headers: { Host: new URL(origin).host, "x-nonce": "attacker-controlled" } }));
}
describe("nonce response policy", () => {
  it("uses fresh unpredictable script nonces, no script unsafe-inline/eval, HSTS and private caching", () => {
    const request = configure("production", "development");
    const response = request();
    const policy = response.headers.get("Content-Security-Policy") ?? "";
    const script = policy.split(";").find((value) => value.trim().startsWith("script-src"));
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toContain("'unsafe-inline'"); expect(script).not.toContain("'unsafe-eval'");
    expect(policy).not.toContain("attacker-controlled");
    const nonce = policy.match(/'nonce-([^']+)'/)?.[1];
    expect(nonce).toBeDefined(); expect(Buffer.from(String(nonce), "base64")).toHaveLength(16);
    expect(request().headers.get("Content-Security-Policy")).not.toBe(policy);
    expect(response.headers.get("Strict-Transport-Security")).toBe("max-age=31536000");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
  it("allows eval/HMR only for explicit loopback development, never optimized local builds", () => {
    const dev = configure("demo", "development")();
    expect(dev.headers.get("Content-Security-Policy")).toContain("'unsafe-eval'");
    expect(dev.headers.get("Content-Security-Policy")).toContain("ws://127.0.0.1:4317");
    expect(dev.headers.get("Strict-Transport-Security")).toBeNull();
    const optimized = configure("demo", "production")();
    expect(optimized.headers.get("Content-Security-Policy")).not.toContain("'unsafe-eval'");
  });
});
