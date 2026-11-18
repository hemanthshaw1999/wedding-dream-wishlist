import { randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { getDatabase, type Database } from "./database.ts";

type AuthOptions = { database: Database; origin: string; secret: string };

export function createAuth({ database, origin, secret }: AuthOptions) {
  if (secret.length < 48) throw new Error("An independently generated auth secret is required.");
  async function enqueue(recipient: string, url: string, kind: "verification" | "recovery") {
    if (!recipient.endsWith("@example.test")) throw new Error("Local mailbox only accepts fictional @example.test addresses.");
    await database.run("DELETE FROM auth_local_outbox WHERE created_at<$1", [new Date(Date.now() - 3_600_000).toISOString()]);
    await database.run("INSERT INTO auth_local_outbox VALUES($1,$2,$3,$4,$5)", [randomUUID(), recipient, kind, url, new Date().toISOString()]);
  }
  return betterAuth({
    appName: "Wedding Dream Wishlist",
    telemetry: { enabled: false },
    database: database.pool,
    secret,
    baseURL: origin,
    trustedOrigins: [origin],
    user: { modelName: "auth_users" },
    session: { modelName: "auth_sessions", expiresIn: 3600, updateAge: 900, cookieCache: { enabled: false } },
    account: { modelName: "auth_accounts" },
    verification: { modelName: "auth_verifications" },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      requireEmailVerification: true,
      autoSignIn: false,
      resetPasswordTokenExpiresIn: 900,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => enqueue(user.email, url, "recovery")
    },
    emailVerification: {
      sendOnSignUp: true,
      expiresIn: 1800,
      sendVerificationEmail: async ({ user, url }) => enqueue(user.email, url, "verification")
    },
    advanced: {
      useSecureCookies: false,
      defaultCookieAttributes: { httpOnly: true, sameSite: "strict", secure: false },
      ipAddress: { disableIpTracking: true }
    },
    rateLimit: {
      enabled: true, storage: "database", modelName: "auth_rate_limits",
      window: 60, max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 100 },
        "/sign-up/email": { window: 60, max: 100 },
        "/request-password-reset": { window: 60, max: 100 }
      }
    },
    logger: {
      log: (level) => {
        if (level === "error" || level === "warn") console.error(JSON.stringify({ event: "auth_library", level }));
      }
    }
  });
}

let instance: ReturnType<typeof createAuth> | undefined;
export function getAuth() {
  const origin = process.env.APP_ORIGIN;
  const secret = process.env.BETTER_AUTH_SECRET;
  if (process.env.DEMO_MODE !== "local-only" || !origin || !secret) throw new Error("Local authentication is not configured.");
  instance ??= createAuth({ database: getDatabase(), origin, secret });
  return instance;
}
