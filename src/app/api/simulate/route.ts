import { NextResponse } from "next/server";

import { runBacktest } from "@/lib/sim/backtest";
import { ensureCandleHistory, loadCloseSeriesFromDb } from "@/lib/server/candle-history";
import { ensureFundingHistory, loadFundingHistoryFromDb } from "@/lib/server/funding-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function intervalToMs(interval: string) {
  if (interval === "1m") return 60_000;
  if (interval === "5m") return 5 * 60_000;
  if (interval === "15m") return 15 * 60_000;
  if (interval === "1h") return 60 * 60_000;
  if (interval === "4h") return 4 * 60 * 60_000;
  if (interval === "1d") return 24 * 60 * 60_000;
  return null;
}

function num(v: unknown) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const symbol = typeof body.symbol === "string" ? body.symbol.toUpperCase() : "";
    const interval = typeof body.interval === "string" ? body.interval : "1h";
    const intervalMs = intervalToMs(interval);
    if (!symbol || !/^[A-Z0-9]{2,10}$/.test(symbol)) {
      return NextResponse.json({ error: "symbol is required" }, { status: 400 });
    }
    if (!intervalMs) {
      return NextResponse.json({ error: "Unsupported interval" }, { status: 400 });
    }

    const now = Date.now();
    const startTime = num(body.startTime) ?? now - 7 * 24 * 60 * 60_000;
    const endTime = num(body.endTime) ?? now;
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
      return NextResponse.json({ error: "Invalid startTime/endTime" }, { status: 400 });
    }

    const zLookbackStepsDefault = Math.max(1, Math.round((24 * 60 * 60_000) / intervalMs));
    const minCrowding = num(body.minCrowding);
    const cfg = {
      intervalMs,
      startingCash: num(body.startingCash) ?? 10_000,
      tradeNotional: num(body.tradeNotional) ?? 1_000,
      slippageBps: num(body.slippageBps) ?? 0,
      useFunding: typeof body.useFunding === "boolean" ? body.useFunding : true,
      volWindowReturns: num(body.volWindowReturns) ?? 48,
      zLookbackSteps: num(body.zLookbackSteps) ?? zLookbackStepsDefault,
      enterAbsZ: num(body.enterAbsZ) ?? 2.0,
      exitAbsZ: num(body.exitAbsZ) ?? 0.5,
      maxHoldSteps: num(body.maxHoldSteps) ?? zLookbackStepsDefault * 7,
      ...(minCrowding === null ? {} : { minCrowding }),
      strategy: {
        kind:
          body.strategy === "momentum"
            ? ("momentum" as const)
            : ("contrarian" as const),
      },
    };

    const simMode = (process.env.BSM_SIM_MODE ?? "").toLowerCase();

    if (simMode === "mock") {
      // Deterministic, network-free fixture for e2e tests.
      const basePrices = [100, 101, 99, 100, 101, 99, 120, 110, 108, 107, 106, 105];
      const candles = basePrices.map((p, i) => ({
        time: startTime + i * intervalMs,
        price: p,
      }));
      const funding = candles.map((c) => ({
        time: c.time,
        fundingRate: 0.01,
        premium: 0.0,
      }));
      const result = runBacktest({ candles, funding, config: cfg });
      return NextResponse.json({
        ts: now,
        mode: "mock",
        symbol,
        interval,
        startTime,
        endTime,
        result,
      });
    }

    const [candleEnsure, fundingEnsure] = await Promise.all([
      ensureCandleHistory({
        symbol,
        interval,
        startTime,
        endTime,
        toleranceMs: intervalMs,
      }),
      ensureFundingHistory({ symbol, startTime, endTime }),
    ]);

    const candles = loadCloseSeriesFromDb({ symbol, interval, startTime, endTime });
    const funding = loadFundingHistoryFromDb({ symbol, startTime, endTime });

    const result = runBacktest({ candles, funding, config: cfg });
    return NextResponse.json({
      ts: now,
      mode: "live",
      symbol,
      interval,
      startTime,
      endTime,
      candles: { fetched: candleEnsure.fetched, rows: candleEnsure.rows, points: candles.length },
      funding: { fetched: fundingEnsure.fetched, rows: fundingEnsure.rows, points: funding.length },
      result,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to simulate" },
      { status: 400 },
    );
  }
}
