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
  funding: number | null;
  premium: number | null;
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
      `SELECT
         m.symbol,
         m.ts,
         m.mid,
         m.prev_day_px,
         m.day_ntl_vlm,
         c.funding,
         c.premium,
         m.realized_vol,
         m.sigma_move_24h,
         m.tail_prob_24h,
         m.ret_24h
       FROM market_metrics_latest m
       LEFT JOIN asset_ctx_latest c ON c.symbol = m.symbol
       ORDER BY m.day_ntl_vlm DESC
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
