import { NextResponse } from "next/server";

import { parseDurationMs } from "@/lib/duration";
import { getCandleSnapshot } from "@/lib/hyperliquid/info";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const coin = url.searchParams.get("coin")?.trim();
  const interval = url.searchParams.get("interval")?.trim() || "1h";

  if (!coin) {
    return NextResponse.json(
      { error: "Missing required query param: coin" },
      { status: 400 },
    );
  }

  const endParam = url.searchParams.get("endTime");
  const startParam = url.searchParams.get("startTime");
  const lookbackParam = url.searchParams.get("lookback") ?? "7d";

  const endTime = endParam ? Number(endParam) : Date.now();
  if (!Number.isFinite(endTime) || endTime <= 0) {
    return NextResponse.json({ error: "Invalid endTime" }, { status: 400 });
  }

  const lookbackMs = parseDurationMs(lookbackParam);
  if (!lookbackMs) {
    return NextResponse.json(
      { error: "Invalid lookback (use e.g. 7d, 24h, 30m)" },
      { status: 400 },
    );
  }

  const startTime = startParam ? Number(startParam) : endTime - lookbackMs;
  if (!Number.isFinite(startTime) || startTime < 0 || startTime >= endTime) {
    return NextResponse.json({ error: "Invalid startTime" }, { status: 400 });
  }

  const candles = await getCandleSnapshot({
    coin,
    interval,
    startTime: Math.floor(startTime),
    endTime: Math.floor(endTime),
  });

  return NextResponse.json({
    ts: Date.now(),
    req: { coin, interval, startTime: Math.floor(startTime), endTime: Math.floor(endTime) },
    candles,
  });
}

