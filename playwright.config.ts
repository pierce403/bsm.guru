import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:3001",
    trace: "retain-on-failure",
  },
  webServer: {
    // NOTE: Next CLI treats a literal "--" as a positional project dir.
    command: "pnpm dev --hostname 127.0.0.1 --port 3001",
    url: "http://127.0.0.1:3001",
    // Reusing can leave a server running and block `./run.sh` via Next's dev lock.
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === "true",
    env: {
      // Never place real orders in e2e runs.
      BSM_TRADING_MODE: "mock",
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
