import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";

const mode = process.argv[2];
if (!["dev", "start"].includes(mode)) throw new Error("Use dev or start.");
const e2e = process.argv.includes("--e2e");
const e2ePath = process.env.E2E_DB_PATH || resolve("data", `e2e-${randomUUID()}.sqlite`);
mkdirSync(resolve("data"), { recursive: true });
const secretPath = resolve("data", "local-auth-secret.txt");
if (!e2e && !existsSync(secretPath)) writeFileSync(secretPath, randomBytes(48).toString("hex"), { flag: "wx", mode: 0o600 });
const authSecret = e2e ? randomBytes(48).toString("hex") : readFileSync(secretPath, "utf8").trim();
const port = e2e ? 4318 : Number(process.env.DEMO_PORT || 4317);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid DEMO_PORT.");
const child = spawn(process.execPath, [
  "node_modules/next/dist/bin/next", mode, "--hostname", "127.0.0.1", "--port", String(port)
], {
  stdio: "inherit",
  env: {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: "1",
    DEMO_MODE: "local-only",
    APP_ORIGIN: `http://127.0.0.1:${port}`,
    BETTER_AUTH_SECRET: authSecret,
    ...(e2e ? { WISHLIST_DB_PATH: e2ePath } : {})
  }
});
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code) => {
  if (e2e) {
    for (const suffix of ["", "-wal", "-shm"]) if (existsSync(`${e2ePath}${suffix}`)) unlinkSync(`${e2ePath}${suffix}`);
  }
  process.exitCode = code ?? 1;
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
