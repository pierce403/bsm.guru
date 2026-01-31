import "server-only";

import { getCandleSnapshot, type HyperliquidCandle } from "@/lib/hyperliquid/info";
import { getDb } from "@/lib/server/db";

export type ClosePoint = { time: number; price: number };

function toNumber(v: unknown) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function loadCloseSeriesFromDb(opts: {
  symbol: string;
  interval: string;
  startTime: number;
  endTime: number;
}): ClosePoint[] {
  const symbol = opts.symbol.toUpperCase();
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT t_end AS time, c AS price
       FROM candles
       WHERE symbol=? AND interval=? AND t_end BETWEEN ? AND ?
       ORDER BY t_end ASC`,
    )
    .all(symbol, opts.interval, opts.startTime, opts.endTime) as Array<{
    time: number;
    price: number;
  }>;

  return rows
    .map((r) => ({ time: r.time, price: toNumber(r.price) ?? NaN }))
    .filter((r) => Number.isFinite(r.time) && Number.isFinite(r.price) && r.price > 0);
}

export async function ensureCandleHistory(opts: {
  symbol: string;
  interval: string;
  startTime: number;
  endTime: number;
  toleranceMs?: number;
  fetcher?: (req: {
    coin: string;
    interval: string;
    startTime: number;
    endTime: number;
  }) => Promise<HyperliquidCandle[]>;
}): Promise<{ fetched: boolean; rows: number }> {
  const symbol = opts.symbol.toUpperCase();
  if (!/^[A-Z0-9]{2,10}$/.test(symbol)) throw new Error("Invalid symbol");
  if (!opts.interval) throw new Error("interval is required");

  const startTime = toNumber(opts.startTime);
  const endTime = toNumber(opts.endTime);
  if (startTime === null || endTime === null) throw new Error("Invalid time range");
  if (endTime <= startTime) throw new Error("endTime must be > startTime");

  const toleranceMs = toNumber(opts.toleranceMs) ?? 60 * 60 * 1000;
  const db = getDb();

  const cov = db
    .prepare(
      `SELECT COUNT(*) AS cnt, MIN(t_end) AS min_time, MAX(t_end) AS max_time
       FROM candles
       WHERE symbol=? AND interval=? AND t_end BETWEEN ? AND ?`,
    )
    .get(symbol, opts.interval, startTime, endTime) as
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

  const fetcher = opts.fetcher ?? ((req) => getCandleSnapshot(req));
  const candles = await fetcher({
    coin: symbol,
    interval: opts.interval,
    startTime,
    endTime,
  });

  const upsert = db.prepare(
    `INSERT INTO candles(symbol, interval, t, t_end, o, c, h, l, v, n)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(symbol, interval, t) DO UPDATE SET
       t_end=excluded.t_end,
       o=excluded.o,
       c=excluded.c,
       h=excluded.h,
       l=excluded.l,
       v=excluded.v,
       n=excluded.n`,
  );

  let inserted = 0;
  db.exec("BEGIN");
  try {
    for (const c of candles) {
      const t = toNumber(c.t);
      const tEnd = toNumber(c.T);
      const o = toNumber(c.o);
      const cc = toNumber(c.c);
      const h = toNumber(c.h);
      const l = toNumber(c.l);
      const v = toNumber(c.v);
      const n = toNumber(c.n);
      if (t === null || tEnd === null || o === null || cc === null || h === null || l === null || v === null || n === null) continue;
      upsert.run(symbol, opts.interval, t, tEnd, o, cc, h, l, v, n);
      inserted += 1;
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }

  return { fetched: true, rows: inserted };
}

