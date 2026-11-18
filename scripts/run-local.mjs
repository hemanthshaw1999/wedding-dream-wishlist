import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { configuredDatabaseUrl, openDatabase } from "../src/server/database.ts";

const mode = process.argv[2];
if (!["dev", "start"].includes(mode)) throw new Error("Use dev or start.");
const e2e = process.argv.includes("--e2e");
if (process.env.APP_ENV === "production") throw new Error("The local launcher cannot run production configuration.");
process.env.DEMO_MODE = "local-only";
const fixture = e2e ? await (await import("../tests/db-fixture.ts")).createTestDatabase({
  name: process.env.E2E_DB_NAME, restrictedRuntime: true
}) : undefined;
const databaseUrl = fixture ? fixture.runtimeUrl : configuredDatabaseUrl();
const check = openDatabase(databaseUrl);
try {
  const marker = await check.get("SELECT value FROM app_metadata WHERE key='environment'");
  if (marker?.value !== (e2e ? "test" : "synthetic-demo-only")) throw new Error("Refusing non-demo database in local launcher.");
  const role = await check.get("SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user");
  if (!role || role.rolsuper || role.rolcreatedb || role.rolcreaterole) throw new Error("Local app must use a restricted runtime role, not a database administrator.");
} finally { await check.close(); }
mkdirSync(resolve("data"), { recursive: true });
const secretPath = resolve("data", "local-auth-secret.txt");
if (!e2e && !existsSync(secretPath)) writeFileSync(secretPath, randomBytes(48).toString("hex"), { flag: "wx", mode: 0o600 });
const authSecret = e2e ? randomBytes(48).toString("hex") : readFileSync(secretPath, "utf8").trim();
const port = e2e ? 4318 : Number(process.env.DEMO_PORT || 4317);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid DEMO_PORT.");
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", mode, "--hostname", "127.0.0.1", "--port", String(port)], {
  stdio: "inherit",
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", DEMO_MODE: "local-only", DATABASE_URL: databaseUrl,
    APP_ORIGIN: `http://127.0.0.1:${port}`, BETTER_AUTH_SECRET: authSecret }
});
try {
  process.exitCode = await new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolveExit(code ?? 1));
    for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
  });
} finally { if (fixture) await fixture.cleanup(); }
