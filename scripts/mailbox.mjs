import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";

const db = new DatabaseSync(process.env.WISHLIST_DB_PATH || resolve("data", "synthetic-demo.sqlite"), { readOnly: true });
try {
  console.log("PRIVATE LOCAL TEST MAILBOX. Never share these verification/recovery links or publish this output.");
  const messages = db.prepare("SELECT recipient, kind, url, created_at FROM auth_local_outbox ORDER BY created_at DESC LIMIT 10").all();
  for (const message of messages) console.log(`${message.created_at} ${message.kind} ${message.recipient}\n${message.url}\n`);
  if (!messages.length) console.log("No local messages. Create a fictional @example.test account first.");
} finally { db.close(); }
