import { spawn } from "node:child_process";
import { authenticationConfig, emailOutboxConfig } from "../src/server/config.ts";
import { getDatabase, type Database } from "../src/server/database.ts";
import { assertDatabaseReady } from "../src/server/readiness.ts";

let database: Database | undefined;
try {
  const config = authenticationConfig();
  if (config.mode !== "production") throw new Error("Production configuration is required.");
  emailOutboxConfig();
  const port = Number(process.env.PORT ?? "3000");
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid production port.");
  database = getDatabase();
  await assertDatabaseReady(database);
  await database.close(); database = undefined;
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", String(port)], {
    stdio: "inherit", env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" }
  });
  process.exitCode = await new Promise<number>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolveExit(code ?? 1));
    for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
  });
} catch {
  console.error(JSON.stringify({ event: "production_start_failed", message: "Production configuration, approved email setup and a migrated restricted database are required. No local fallback is allowed." }));
  process.exitCode = 1;
} finally { await database?.close(); }
