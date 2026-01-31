import { describe, expect, it } from "vitest";

import { runBacktest, type CandlePoint, type FundingPoint } from "@/lib/sim/backtest";

function makeCandles(prices: number[], intervalMs: number): CandlePoint[] {
  return prices.map((p, i) => ({ time: i * intervalMs, price: p }));
}

function makeFunding(times: number[], fundingRate: number, premium: number): FundingPoint[] {
  return times.map((t) => ({ time: t, fundingRate, premium }));
}

describe("backtest", () => {
  it("can profit on a mean-reversion move (contrarian)", () => {
    const intervalMs = 60 * 60 * 1000;
    const prices = [100, 101, 99, 100, 101, 99, 120, 110, 108, 107, 106, 105];
    const candles = makeCandles(prices, intervalMs);

    const res = runBacktest({
      candles,
      config: {
        intervalMs,
        startingCash: 1000,
        tradeNotional: 500,
        slippageBps: 0,
        useFunding: false,
        volWindowReturns: 5,
        zLookbackSteps: 1,
        enterAbsZ: 2,
        exitAbsZ: 0.1,
        maxHoldSteps: 1,
        strategy: { kind: "contrarian" },
      },
    });

    expect(res.trades.length).toBe(1);
    expect(res.trades[0]!.side).toBe("short");
    expect(res.trades[0]!.totalPnl).toBeGreaterThan(0);
    expect(res.summary.endingEquity).toBeGreaterThan(res.summary.startingCash);
  });

  it("funding carry affects PnL when enabled", () => {
    const intervalMs = 60 * 60 * 1000;
    const prices = [100, 101, 99, 100, 101, 99, 120, 110, 108, 107, 106, 105];
    const candles = makeCandles(prices, intervalMs);
    const funding = makeFunding(
      candles.map((c) => c.time),
      0.01, // 100 bps per hour (intentionally huge for test visibility)
      0.0,
    );

    const base = {
      intervalMs,
      startingCash: 1000,
      tradeNotional: 500,
      slippageBps: 0,
      volWindowReturns: 5,
      zLookbackSteps: 1,
      enterAbsZ: 2,
      exitAbsZ: 0.1,
      maxHoldSteps: 1,
      strategy: { kind: "contrarian" as const },
    };

    const noFunding = runBacktest({ candles, funding, config: { ...base, useFunding: false } });
    const withFunding = runBacktest({ candles, funding, config: { ...base, useFunding: true } });

    expect(noFunding.trades.length).toBe(1);
    expect(withFunding.trades.length).toBe(1);
    expect(withFunding.trades[0]!.fundingPnl).toBeGreaterThan(0);
    expect(withFunding.trades[0]!.totalPnl).toBeGreaterThan(noFunding.trades[0]!.totalPnl);
  });

  it("can require crowding alignment via minCrowding", () => {
    const intervalMs = 60 * 60 * 1000;
    const prices = [100, 101, 99, 100, 101, 99, 120, 110, 108, 107, 106, 105];
    const candles = makeCandles(prices, intervalMs);
    const times = candles.map((c) => c.time);

    const adverseFunding: FundingPoint[] = makeFunding(times, -0.005, -0.005);

    const res = runBacktest({
      candles,
      funding: adverseFunding,
      config: {
        intervalMs,
        startingCash: 1000,
        tradeNotional: 500,
        slippageBps: 0,
        useFunding: true,
        volWindowReturns: 5,
        zLookbackSteps: 1,
        enterAbsZ: 2,
        exitAbsZ: 0.1,
        maxHoldSteps: 1,
        minCrowding: 1.2,
        strategy: { kind: "contrarian" },
      },
    });

    expect(res.trades.length).toBe(0);
  });
});

