import { NextResponse } from "next/server";

import { getDb } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = {
  symbol: string;
  ts: number;
  mid: number;
  prev_day_px: number | null;
  day_ntl_vlm: number | null;
  realized_vol: number | null;
  sigma_move_24h: number | null;
  tail_prob_24h: number | null;
  ret_24h: number | null;
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limitRaw = url.searchParams.get("limit");
  const limit = (() => {
    const n = limitRaw ? Number(limitRaw) : 50;
    return Number.isFinite(n) ? Math.min(Math.max(Math.floor(n), 1), 200) : 50;
  })();

  const db = getDb();

  const lastSync = db
    .prepare(`SELECT value, updated_at FROM sync_state WHERE key=?`)
    .get("last_hyperliquid_sync") as { value: string; updated_at: number } | undefined;

  const rows = db
    .prepare(
      `SELECT symbol, ts, mid, prev_day_px, day_ntl_vlm, realized_vol, sigma_move_24h, tail_prob_24h, ret_24h
       FROM market_metrics_latest
       ORDER BY day_ntl_vlm DESC
       LIMIT ?`,
    )
    .all(limit) as Row[];

  return NextResponse.json({
    ts: Date.now(),
    lastSync: lastSync
      ? { ts: Number(lastSync.value) || lastSync.updated_at }
      : null,
    rows,
  });
}

