import "server-only";

import { getFundingHistory, type HyperliquidFundingHistoryEntry } from "@/lib/hyperliquid/info";
import { getDb } from "@/lib/server/db";

export type FundingPoint = {
  time: number;
  fundingRate: number;
  premium: number;
};

function toNumber(v: unknown) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function loadFundingHistoryFromDb(opts: {
  symbol: string;
  startTime: number;
  endTime: number;
}): FundingPoint[] {
  const symbol = opts.symbol.toUpperCase();
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT time, funding_rate, premium
       FROM funding_history
       WHERE symbol=? AND time BETWEEN ? AND ?
       ORDER BY time ASC`,
    )
    .all(symbol, opts.startTime, opts.endTime) as Array<{
    time: number;
    funding_rate: number;
    premium: number;
  }>;

  return rows
    .map((r) => ({
      time: r.time,
      fundingRate: toNumber(r.funding_rate) ?? 0,
      premium: toNumber(r.premium) ?? 0,
    }))
    .filter((r) => Number.isFinite(r.time));
}

export async function ensureFundingHistory(opts: {
  symbol: string;
  startTime: number;
  endTime: number;
  // If DB coverage is within this tolerance at the edges, we skip fetching.
  toleranceMs?: number;
  // Dependency injection for tests.
  fetcher?: (req: {
    coin: string;
    startTime: number;
    endTime: number;
  }) => Promise<HyperliquidFundingHistoryEntry[]>;
}): Promise<{ fetched: boolean; rows: number }> {
  const symbol = opts.symbol.toUpperCase();
  if (!/^[A-Z0-9]{2,10}$/.test(symbol)) throw new Error("Invalid symbol");

  const startTime = toNumber(opts.startTime);
  const endTime = toNumber(opts.endTime);
  if (startTime === null || endTime === null) throw new Error("Invalid time range");
  if (endTime <= startTime) throw new Error("endTime must be > startTime");

  const db = getDb();
  const toleranceMs = toNumber(opts.toleranceMs) ?? 60 * 60 * 1000;

  const cov = db
    .prepare(
      `SELECT COUNT(*) AS cnt, MIN(time) AS min_time, MAX(time) AS max_time
       FROM funding_history
       WHERE symbol=? AND time BETWEEN ? AND ?`,
    )
    .get(symbol, startTime, endTime) as
    | { cnt: number; min_time: number | null; max_time: number | null }
    | undefined;

  const cnt = cov ? toNumber(cov.cnt) ?? 0 : 0;
  const minTime = cov ? toNumber(cov.min_time) : null;
  const maxTime = cov ? toNumber(cov.max_time) : null;

  const covered =
    cnt > 0 &&
    minTime !== null &&
    maxTime !== null &&
    minTime <= startTime + toleranceMs &&
    maxTime >= endTime - toleranceMs;

  if (covered) return { fetched: false, rows: cnt };

  const fetcher = opts.fetcher ?? ((req) => getFundingHistory(req));
  const entries = await fetcher({ coin: symbol, startTime, endTime });

  const upsert = db.prepare(
    `INSERT INTO funding_history(symbol, time, funding_rate, premium)
     VALUES(?, ?, ?, ?)
     ON CONFLICT(symbol, time) DO UPDATE SET
       funding_rate=excluded.funding_rate,
       premium=excluded.premium`,
  );

  let inserted = 0;
  db.exec("BEGIN");
  try {
    for (const e of entries) {
      const t = toNumber(e.time);
      const f = toNumber(e.fundingRate);
      const p = toNumber(e.premium);
      if (t === null || f === null || p === null) continue;
      upsert.run(symbol, t, f, p);
      inserted += 1;
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }

  return { fetched: true, rows: inserted };
}

