import { emailOutboxConfig } from "../src/server/config.ts";
import { getDatabase, type Database } from "../src/server/database.ts";
import { dispatchAuthEmail } from "../src/server/email.ts";

let database: Database | undefined;
try {
  const config = emailOutboxConfig();
  database = getDatabase();
  await database.ready();
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("Server-only mail provider credentials are not configured.");
  const outcome = await dispatchAuthEmail(database, { key: config.key, apiKey });
  console.log(JSON.stringify({ event: "auth_email_worker", outcome }));
  if (["failed", "unknown", "quota", "retry", "lease_lost"].includes(outcome)) process.exitCode = 1;
} catch {
  console.error(JSON.stringify({ event: "auth_email_worker_failed", message: "Check approved server configuration and queue health; private error details are withheld." }));
  process.exitCode = 1;
} finally { await database?.close(); }
