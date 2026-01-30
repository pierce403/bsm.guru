import { NextResponse } from "next/server";

import { syncHyperliquidOnce } from "@/lib/server/sync/hyperliquid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let overrides: Record<string, unknown> | null = null;
  try {
    overrides = (await req.json()) as Record<string, unknown>;
  } catch {
    // ignore
  }

  const result = await syncHyperliquidOnce({
    topN: typeof overrides?.topN === "number" ? overrides.topN : undefined,
    candleInterval:
      typeof overrides?.candleInterval === "string"
        ? overrides.candleInterval
        : undefined,
    candleLookbackDays:
      typeof overrides?.candleLookbackDays === "number"
        ? overrides.candleLookbackDays
        : undefined,
    candleRefreshMinutes:
      typeof overrides?.candleRefreshMinutes === "number"
        ? overrides.candleRefreshMinutes
        : undefined,
    concurrency:
      typeof overrides?.concurrency === "number" ? overrides.concurrency : undefined,
  });

  return NextResponse.json(result);
}

