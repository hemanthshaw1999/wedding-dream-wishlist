import { configuredDatabaseUrl, openDatabase } from "../src/server/database.ts";

process.env.DEMO_MODE = "local-only";
const url = configuredDatabaseUrl();
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)) throw new Error("Local mailbox refuses remote databases.");
const db = openDatabase(url);
try {
  const marker = await db.get("SELECT value FROM app_metadata WHERE key='environment'");
  if (marker?.value !== "synthetic-demo-only") throw new Error("Local mailbox refuses non-demo data.");
  console.log("PRIVATE LOCAL TEST MAILBOX. Never share these verification/recovery links or publish this output.");
  const messages = await db.all("SELECT recipient,kind,url,created_at FROM auth_local_outbox WHERE created_at>$1 ORDER BY created_at DESC LIMIT 10",
    [new Date(Date.now() - 3_600_000).toISOString()]);
  for (const message of messages) console.log(`${message.created_at} ${message.kind} ${message.recipient}\n${message.url}\n`);
  if (!messages.length) console.log("No recent local messages. Create a fictional @example.test account first.");
} finally { await db.close(); }
