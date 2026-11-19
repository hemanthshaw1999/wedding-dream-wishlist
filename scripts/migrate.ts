import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { grantEmailRuntime, grantRuntime, migrate, openDatabase, type DatabaseEnvironment } from "../src/server/database.ts";

const production = process.env.APP_ENV === "production";
const local = production ? undefined : JSON.parse(readFileSync(resolve("data", "local-postgres.json"), "utf8")) as { migrationUrl: string };
const url = process.env.MIGRATION_DATABASE_URL || local?.migrationUrl;
if (!url) throw new Error("Set MIGRATION_DATABASE_URL through secure server configuration.");
const db = openDatabase(url);
try {
  const environment: DatabaseEnvironment = production ? "production" : "synthetic-demo-only";
  await migrate(db, environment);
  const role = process.env.DATABASE_RUNTIME_ROLE || (production ? "" : "wishlist_app");
  await grantRuntime(db, role);
  const emailRole = process.env.DATABASE_EMAIL_ROLE;
  if (emailRole) {
    if (emailRole === role) throw new Error("Email and web runtime roles must be distinct.");
    await grantEmailRuntime(db, emailRole);
  }
  console.log(`PostgreSQL migrations and restricted runtime grants applied (${environment}).`);
} finally { await db.close(); }
