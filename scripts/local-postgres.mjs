import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "pg";

const bin = process.env.PG_BIN || join(homedir(), ".local", "share", "wedding-wishlist-tools", "postgresql-18.7", "pgsql", "bin");
const executable = (name) => join(bin, `${name}${process.platform === "win32" ? ".exe" : ""}`);
if (!existsSync(executable("postgres"))) throw new Error("Set PG_BIN to an installed supported PostgreSQL bin directory. This script never installs a machine-wide service.");
const data = resolve("data");
const cluster = join(data, "postgres-cluster");
const configPath = join(data, "local-postgres.json");
mkdirSync(data, { recursive: true });
let config;
if (existsSync(configPath)) {
  config = JSON.parse(readFileSync(configPath, "utf8"));
  if (config.environment !== "synthetic-demo-only") throw new Error("Refusing non-demo local configuration.");
} else {
  if (existsSync(cluster)) throw new Error("Existing cluster has no matching configuration; refusing to reinitialize.");
  const url = (role, password, database) => `postgresql://${role}:${password}@127.0.0.1:55432/${database}`;
  config = {
    environment: "synthetic-demo-only",
    adminUrl: url("wishlist_admin", randomBytes(48).toString("hex"), "postgres"),
    migrationUrl: url("wishlist_migrator", randomBytes(48).toString("hex"), "wedding_wishlist_demo"),
    applicationUrl: url("wishlist_app", randomBytes(48).toString("hex"), "wedding_wishlist_demo")
  };
  writeFileSync(configPath, JSON.stringify(config, null, 2), { flag: "wx", mode: 0o600 });
}
for (const name of ["adminUrl", "migrationUrl", "applicationUrl"]) {
  const url = new URL(config[name]);
  if (url.hostname !== "127.0.0.1" || url.port !== "55432" || !/^[a-f0-9]{96}$/.test(url.password)) throw new Error("Unexpected local database configuration.");
}
if (!existsSync(join(cluster, "PG_VERSION"))) {
  const passwordFile = join(data, "postgres-init-password");
  writeFileSync(passwordFile, new URL(config.adminUrl).password, { flag: "wx", mode: 0o600 });
  try {
    const initialized = spawnSync(executable("initdb"), ["-D", cluster, "--username=wishlist_admin", "--auth=scram-sha-256",
      "--encoding=UTF8", "--locale=C", `--pwfile=${passwordFile}`], { stdio: "inherit" });
    if (initialized.error) throw initialized.error;
    if (initialized.status !== 0) throw new Error("Isolated PostgreSQL initialization failed.");
  } finally { unlinkSync(passwordFile); }
}
const server = spawn(executable("postgres"), ["-D", cluster, "-h", "127.0.0.1", "-p", "55432",
  "-c", "log_statement=none", "-c", "log_min_error_statement=panic"], { stdio: "inherit" });
const exit = new Promise((resolveExit, reject) => {
  server.once("error", reject);
  server.once("exit", (code) => resolveExit(code ?? 1));
});
let ready = false;
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error("Isolated PostgreSQL process exited before readiness.");
    const client = new Client({ connectionString: config.adminUrl, connectionTimeoutMillis: 1000 });
    try {
      await client.connect();
      for (const [role, field] of [["wishlist_migrator", "migrationUrl"], ["wishlist_app", "applicationUrl"]]) {
        const found = await client.query("SELECT rolname FROM pg_roles WHERE rolname=$1", [role]);
        if (!found.rowCount) await client.query(`CREATE ROLE ${role} LOGIN PASSWORD '${new URL(config[field]).password}'`);
      }
      const database = await client.query("SELECT datname FROM pg_database WHERE datname='wedding_wishlist_demo'");
      if (!database.rowCount) await client.query("CREATE DATABASE wedding_wishlist_demo OWNER wishlist_migrator");
      ready = true;
      break;
    } catch (error) {
      if (!["ECONNREFUSED", "57P03"].includes(error.code)) throw error;
      await delay(100);
    } finally { await client.end(); }
  }
  if (!ready) throw new Error("Local PostgreSQL readiness timed out.");
  console.log("Isolated PostgreSQL ready on 127.0.0.1:55432. Durable cluster: data\\postgres-cluster. Credentials are in ignored data\\local-postgres.json; never share them.");
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill(signal));
  process.exitCode = await exit;
} catch (error) {
  server.kill("SIGTERM");
  throw error;
}
