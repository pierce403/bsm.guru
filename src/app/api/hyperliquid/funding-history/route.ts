import { NextResponse } from "next/server";

import { ensureFundingHistory, loadFundingHistoryFromDb } from "@/lib/server/funding-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const coin = (url.searchParams.get("coin") ?? "").toUpperCase();
  const now = Date.now();

  const startTimeRaw = url.searchParams.get("startTime");
  const endTimeRaw = url.searchParams.get("endTime");

  const startTime = startTimeRaw ? Number(startTimeRaw) : now - 7 * 24 * 60 * 60 * 1000;
  const endTime = endTimeRaw ? Number(endTimeRaw) : now;

  if (!coin || !/^[A-Z0-9]{2,10}$/.test(coin)) {
    return NextResponse.json({ error: "coin is required" }, { status: 400 });
  }
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
    return NextResponse.json({ error: "Invalid startTime/endTime" }, { status: 400 });
  }

  const res = await ensureFundingHistory({ symbol: coin, startTime, endTime });
  const rows = loadFundingHistoryFromDb({ symbol: coin, startTime, endTime });

  return NextResponse.json({
    ts: now,
    coin,
    startTime,
    endTime,
    fetched: res.fetched,
    rows,
  });
}

