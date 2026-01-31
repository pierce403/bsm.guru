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
    // Use `next start` to avoid `.next/dev/lock` conflicts with a local `next dev` you may be running.
    // NOTE: avoid passing a literal `--` (pnpm can forward it and Next will treat it as a directory arg).
    command: "pnpm build && pnpm exec next start -H 127.0.0.1 -p 3001",
    url: "http://127.0.0.1:3001",
    // Reusing can leave a server running and block `./run.sh` via Next's dev lock.
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === "true",
    env: {
      // Never place real orders in e2e runs.
      BSM_TRADING_MODE: "mock",
      // Keep simulations deterministic + network-free in e2e.
      BSM_SIM_MODE: "mock",
      // Keep e2e isolated from your real local DB + wallets.
      BSM_DB_PATH: "logs/_e2e/bsm.sqlite",
      BSM_WALLET_DIR: "logs/_e2e/wallets",
      // Keep Next output isolated too so building for e2e doesn't clobber your dev server's `.next`.
      BSM_NEXT_DIST_DIR: ".next-e2e",
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
