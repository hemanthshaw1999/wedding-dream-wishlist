import { backup, DatabaseSync } from "node:sqlite";
import { copyFileSync, mkdirSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { openDatabase } from "../src/server/database.ts";

const db = openDatabase(process.env.WISHLIST_DB_PATH || resolve("data", "synthetic-demo.sqlite"));
const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
const backupPath = resolve("data", "backups", `synthetic-demo-${stamp}.sqlite`);
const restorePath = resolve("data", "backups", `restore-drill-${stamp}.sqlite`);
mkdirSync(resolve("data", "backups"), { recursive: true });
try {
  await backup(db, backupPath);
  copyFileSync(backupPath, restorePath);
  const restored = new DatabaseSync(restorePath, { readOnly: true });
  try {
    const integrity = restored.prepare("PRAGMA integrity_check").get();
    if (integrity?.integrity_check !== "ok" || restored.prepare("PRAGMA foreign_key_check").all().length) {
      throw new Error("Restored database failed integrity checks.");
    }
    if (restored.prepare("SELECT value FROM app_metadata WHERE key='environment'").get()?.value !== "synthetic-demo-only") {
      throw new Error("Restored database has no synthetic-demo marker.");
    }
    for (const table of ["wishlists", "goals", "memberships", "audit_entries", "recipient_snapshots",
      "contributions", "claim_events", "auth_users", "auth_sessions", "auth_accounts", "auth_verifications", "auth_local_outbox"]) {
      const source = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count;
      const target = restored.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count;
      if (source !== target) throw new Error(`Restore count mismatch: ${table}. Retry while the app is stopped.`);
    }
    console.log(`Backup and isolated restore integrity/count checks passed: ${backupPath}`);
  } finally { restored.close(); }
  unlinkSync(restorePath);
} finally { db.close(); }
