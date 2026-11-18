import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export function openDatabase(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA busy_timeout=5000;");
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    if (tables.length && (!tables.some((table) => table.name === "app_metadata") ||
      db.prepare("SELECT value FROM app_metadata WHERE key='environment'").get()?.value !== "synthetic-demo-only")) {
      throw new Error("Refusing to modify an unmarked database.");
    }
    db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
    db.exec("BEGIN IMMEDIATE");
    db.exec("CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT;");
    if (!db.prepare("SELECT version FROM schema_migrations WHERE version=1").get()) {
      db.exec(readFileSync(resolve("migrations", "001_demo.sql"), "utf8"));
      db.prepare("INSERT INTO schema_migrations VALUES(1, ?)").run(new Date().toISOString());
    }
    if (!db.prepare("SELECT version FROM schema_migrations WHERE version=2").get()) {
      db.exec(readFileSync(resolve("migrations", "002_auth_and_claims.sql"), "utf8"));
      db.prepare("INSERT INTO schema_migrations VALUES(2, ?)").run(new Date().toISOString());
    }
    db.exec("COMMIT");
    return db;
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    db.close();
    throw error;
  }
}

let connection: DatabaseSync | undefined;
export function getDatabase(): DatabaseSync {
  if (process.env.DEMO_MODE !== "local-only") throw new Error("Local demo is disabled.");
  connection ??= openDatabase(process.env.WISHLIST_DB_PATH || resolve("data", "synthetic-demo.sqlite"));
  return connection;
}
