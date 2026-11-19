import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { configuredDatabaseUrl, openDatabase } from "../src/server/database.ts";
import { createTestDatabase } from "../tests/db-fixture.ts";

process.env.DEMO_MODE = "local-only";
const url = configuredDatabaseUrl();
const db = openDatabase(url);
const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
const backupPath = resolve("data", "backups", `synthetic-demo-${stamp}.dump`);
const bin = process.env.PG_BIN || join(homedir(), ".local", "share", "wedding-wishlist-tools", "postgresql-18.7", "pgsql", "bin");
function command(program: string, args: string[], connectionString: string): Promise<void> {
  const target = new URL(connectionString);
  return new Promise((resolveCommand, reject) => {
    const child = spawn(join(bin, `${program}${process.platform === "win32" ? ".exe" : ""}`), args, {
      stdio: "ignore",
      env: { ...process.env, PGHOST: target.hostname, PGPORT: target.port || "5432", PGUSER: decodeURIComponent(target.username),
        PGPASSWORD: decodeURIComponent(target.password), PGDATABASE: target.pathname.slice(1),
        PGSSLMODE: ["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) ? "disable" : "verify-full" }
    });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolveCommand() : reject(new Error(`${program} failed with exit ${code}; database output was withheld to protect private data.`)));
  });
}
const tables = ["wishlists", "goals", "goal_history", "memberships", "audit_entries", "recipient_snapshots",
  "contributions", "claim_events", "auth_users", "auth_sessions", "auth_accounts", "auth_verifications", "auth_local_outbox",
  "auth_email_outbox", "auth_email_budgets"] as const;
try {
  if ((await db.get("SELECT value FROM app_metadata WHERE key='environment'"))?.value !== "synthetic-demo-only") throw new Error("Demo backup refuses non-synthetic data.");
  mkdirSync(resolve("data", "backups"), { recursive: true });
  const restored = await createTestDatabase({ migrate: false });
  try {
    await db.transaction(async (snapshotDb) => {
      await snapshotDb.run("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
      const snapshot = await snapshotDb.get<{ id: string }>("SELECT pg_export_snapshot() AS id");
      if (!snapshot) throw new Error("Could not export a consistent backup snapshot.");
      await command("pg_dump", ["--format=custom", "--no-owner", "--no-acl", "--snapshot", snapshot.id, "--file", backupPath], url);
      await command("pg_restore", ["--exit-on-error", "--no-owner", "--no-acl", "--dbname", new URL(restored.connectionString).pathname.slice(1), backupPath], restored.connectionString);
      for (const table of tables) {
        const source = await snapshotDb.get(`SELECT COUNT(*) AS count FROM ${table}`);
        const target = await restored.db.get(`SELECT COUNT(*) AS count FROM ${table}`);
        if (source?.count !== target?.count) throw new Error(`Restore count mismatch: ${table}.`);
      }
      const mismatches = await restored.db.all(`SELECT c.id FROM contributions c LEFT JOIN claim_events e ON e.contribution_id=c.id
        GROUP BY c.id HAVING COALESCE(SUM(e.confirmed_delta_paise),0)<>CASE WHEN c.status='owner_confirmed' THEN c.amount_paise ELSE 0 END`);
      if (mismatches.length) throw new Error("Restored ledger does not match contribution states.");
      const goalMismatches = await restored.db.all(`SELECT g.id FROM goals g LEFT JOIN goal_history h
        ON h.goal_id=g.id AND h.version=g.version WHERE h.goal_id IS NULL OR h.after_snapshot IS DISTINCT FROM to_jsonb(g)
        OR g.version<>(SELECT max(version) FROM goal_history WHERE goal_id=g.id)`);
      if (goalMismatches.length) throw new Error("Restored goals do not match their immutable revision history.");
      if ((await restored.db.get("SELECT value FROM app_metadata WHERE key='environment'"))?.value !== "synthetic-demo-only") throw new Error("Restored environment marker changed.");
    });
    console.log(`PostgreSQL consistent-snapshot backup, isolated restore, row-count and ledger checks passed: ${backupPath}`);
  } finally { await restored.cleanup(); }
} finally { await db.close(); }
