type Environment = Readonly<Record<string, string | undefined>>;

export function applicationConfig(env: Environment = process.env) {
  const origin = env.APP_ORIGIN;
  if (!origin) throw new Error("APP_ORIGIN is required.");
  const url = new URL(origin);
  if (url.origin !== origin || url.username || url.password) throw new Error("APP_ORIGIN must be an exact canonical origin.");
  if (env.APP_ENV === "production") {
    if (env.DEMO_MODE || url.protocol !== "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new Error("Production requires HTTPS and cannot enable the local demo gate.");
    }
    return { mode: "production" as const, origin };
  }
  if (env.APP_ENV && !["development", "test"].includes(env.APP_ENV)) throw new Error("Unknown APP_ENV.");
  if (env.DEMO_MODE !== "local-only" || !/^http:\/\/127\.0\.0\.1:\d{4,5}$/.test(origin)) {
    throw new Error("Explicit loopback demo configuration is required.");
  }
  return { mode: "demo" as const, origin };
}

export function authenticationConfig(env: Environment = process.env) {
  const application = applicationConfig(env);
  const secret = env.BETTER_AUTH_SECRET;
  if (!secret || (application.mode === "production" ? !/^[a-f0-9]{96}$/i.test(secret) : secret.length < 48)) {
    throw new Error("An independently generated server-only authentication secret is required.");
  }
  return { ...application, secret };
}

// Operator attestation gate for live direct-UPI activation. This variable alone never
// activates anything: each wishlist still requires the reviewed, reauthenticated owner
// activation flow, and no environment value can create or bind recipient instructions.
// Unset (the default everywhere) disables all live payment behavior server-side.
export function liveUpiApproved(env: Environment = process.env): boolean {
  return env.LIVE_UPI_APPROVED === "yes";
}

export function isEmailAddress(value: string) {
  return value.length <= 254 && value.split("@")[0].length <= 64 &&
    /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,63}$/i.test(value);
}

export function emailOutboxConfig(env: Environment = process.env) {
  const application = applicationConfig(env);
  const provider = env.EMAIL_DELIVERY_APPROVED;
  if (provider !== "resend-free" && provider !== "brevo-free") {
    throw new Error("Email requires explicit approval of the provider, free plan, sender and data processing.");
  }
  if (application.mode !== "production") {
    throw new Error("Email requires explicit approval of the provider, free plan, sender and data processing.");
  }
  if (!env.EMAIL_OUTBOX_KEY || !/^[a-f0-9]{64}$/i.test(env.EMAIL_OUTBOX_KEY)) throw new Error("An independent 256-bit email encryption key is required.");
  if (!env.EMAIL_FROM || !isEmailAddress(env.EMAIL_FROM) || env.EMAIL_SENDER_VERIFIED !== "yes") {
    throw new Error("A separately verified sender domain/address is required.");
  }
  return { origin: application.origin, key: Buffer.from(env.EMAIL_OUTBOX_KEY, "hex"), from: env.EMAIL_FROM, provider: provider as "resend-free" | "brevo-free" };
}
