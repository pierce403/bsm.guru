import { expect, test } from "@playwright/test";

type SimulateResponse = {
  mode: "mock" | "live";
  symbol: string;
  result?: {
    summary?: { tradeCount?: number };
    trades?: Array<{ side: string; fundingPnl: number }>;
  };
};

test("simulate endpoint returns a deterministic backtest in mock mode", async ({ request }) => {
  const intervalMs = 60 * 60 * 1000;

  const res = await request.post("/api/simulate", {
    data: {
      symbol: "TST",
      interval: "1h",
      startTime: 0,
      endTime: 11 * intervalMs,
      startingCash: 1000,
      tradeNotional: 500,
      slippageBps: 0,
      useFunding: true,
      volWindowReturns: 5,
      zLookbackSteps: 1,
      enterAbsZ: 2,
      exitAbsZ: 0.1,
      maxHoldSteps: 1,
      strategy: "contrarian",
    },
  });

  expect(res.ok()).toBeTruthy();
  const json = (await res.json()) as SimulateResponse;

  expect(json.mode).toBe("mock");
  expect(json.symbol).toBe("TST");
  expect(json.result?.summary?.tradeCount ?? 0).toBeGreaterThan(0);
  expect(json.result?.trades?.length ?? 0).toBeGreaterThan(0);
  expect(json.result!.trades![0]!.side).toBe("short");
  expect(json.result!.trades![0]!.fundingPnl).toBeGreaterThan(0);
});
