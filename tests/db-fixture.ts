import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { grantEmailRuntime, grantRuntime, migrate, openDatabase } from "../src/server/database.ts";

export async function createTestDatabase(options: { name?: string; migrate?: boolean; restrictedRuntime?: boolean | "email"; environment?: "test" | "synthetic-demo-only" } = {}) {
  const local = process.env.WISHLIST_TEST_ADMIN_URL ? undefined :
    JSON.parse(readFileSync(resolve("data", "local-postgres.json"), "utf8")) as { adminUrl: string };
  const adminUrl = process.env.WISHLIST_TEST_ADMIN_URL || local?.adminUrl;
  if (!adminUrl) throw new Error("Isolated test PostgreSQL administrator configuration is required.");
  const url = new URL(adminUrl);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("Tests refuse a non-loopback PostgreSQL administrator.");
  const name = options.name ?? `wishlist_test_${randomBytes(16).toString("hex")}`;
  if (!/^wishlist_(test|e2e)_[a-f0-9]{32}$/.test(name)) throw new Error("Invalid isolated test database name.");
  const admin = openDatabase(adminUrl);
  await admin.run(`CREATE DATABASE "${name}"`);
  url.pathname = `/${name}`;
  const connectionString = url.toString();
  const db = openDatabase(connectionString);
  let runtimeRole: string | undefined;
  let runtimeUrl = connectionString;
  async function cleanup() {
    if (!db.pool.ended) await db.close();
    await admin.run(`DROP DATABASE "${name}" WITH (FORCE)`);
    if (runtimeRole) await admin.run(`DROP ROLE "${runtimeRole}"`);
    await admin.close();
  }
  try {
    if (options.migrate !== false) await migrate(db, options.environment ?? "test");
    if (options.restrictedRuntime) {
      runtimeRole = `wishlist_runtime_${randomBytes(12).toString("hex")}`;
      const password = randomBytes(48).toString("hex");
      await admin.run(`CREATE ROLE "${runtimeRole}" LOGIN PASSWORD '${password}'`);
      await (options.restrictedRuntime === "email" ? grantEmailRuntime : grantRuntime)(db, runtimeRole);
      url.username = runtimeRole;
      url.password = password;
      runtimeUrl = url.toString();
    }
    return { db, connectionString, runtimeUrl, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
