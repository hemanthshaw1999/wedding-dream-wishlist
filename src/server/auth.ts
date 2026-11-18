import { randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { getDatabase, type Database } from "./database.ts";
import { authenticationConfig, emailOutboxConfig } from "./config.ts";
import { enqueueAuthEmail } from "./email.ts";

type AuthOptions = {
  database: Database; origin: string; secret: string;
  deliver?: (recipient: string, url: string, kind: "verification" | "recovery") => Promise<void>;
};

export function createAuth({ database, origin, secret, deliver }: AuthOptions) {
  if (secret.length < 48) throw new Error("An independently generated auth secret is required.");
  const secure = new URL(origin).protocol === "https:";
  if (!secure && !/^http:\/\/127\.0\.0\.1:\d{4,5}$/.test(origin)) throw new Error("Authentication requires HTTPS outside the loopback demo.");
  if (secure && !deliver) throw new Error("HTTPS authentication requires a configured private email delivery adapter.");
  async function enqueue(recipient: string, url: string, kind: "verification" | "recovery") {
    if (deliver) return deliver(recipient, url, kind);
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
      useSecureCookies: secure,
      defaultCookieAttributes: { httpOnly: true, sameSite: "strict", secure },
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
export async function getAuth() {
  const config = authenticationConfig();
  const database = getDatabase();
  await database.ready();
  if (!instance) {
    const mail = config.mode === "production" ? emailOutboxConfig() : undefined;
    instance = createAuth({ database, origin: config.origin, secret: config.secret,
      deliver: mail ? (recipient, url, kind) => enqueueAuthEmail(database, mail, recipient, url, kind) : undefined });
  }
  return instance;
}
