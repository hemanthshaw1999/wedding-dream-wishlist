import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve("data", "browsers");
process.env.E2E_DB_PATH ??= resolve("data", `e2e-${randomUUID()}.sqlite`);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4318",
    trace: "off",
    screenshot: "only-on-failure"
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"], defaultBrowserType: "chromium" } }
  ],
  webServer: {
    command: "node scripts/run-local.mjs start --e2e",
    url: "http://127.0.0.1:4318",
    reuseExistingServer: false,
    timeout: 120000
  }
});
