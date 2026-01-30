import "server-only";

import { getCandleSnapshot, getMetaAndAssetCtxs } from "@/lib/hyperliquid/info";
import { getDb } from "@/lib/server/db";
import { normCdf } from "@/lib/quant/normal";
import { realizedVol } from "@/lib/quant/vol";

const MS_PER_DAY = 86_400_000;

function envNumber(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const v = Number(raw);
  return Number.isFinite(v) ? v : fallback;
}

function intervalToSeconds(interval: string) {
  if (interval === "1m") return 60;
  if (interval === "5m") return 5 * 60;
  if (interval === "15m") return 15 * 60;
  if (interval === "1h") return 60 * 60;
  if (interval === "4h") return 4 * 60 * 60;
  if (interval === "1d") return 24 * 60 * 60;
  return null;
}

function toNumber(raw: string) {
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
) {
  const out = new Array<R>(items.length);
  let i = 0;

  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx], idx);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () =>
    worker(),
  );
  await Promise.all(workers);
  return out;
}

export type HyperliquidSyncConfig = {
  topN: number;
  candleInterval: string;
  candleLookbackDays: number;
  candleRefreshMinutes: number;
  concurrency: number;
};

export type HyperliquidSyncResult = {
  ts: number;
  topN: number;
  candleInterval: string;
  candleLookbackDays: number;
  coins: string[];
  candlesFetched: number;
  metricsUpdated: number;
};

let syncInFlight = false;

export async function syncHyperliquidOnce(
  cfg?: Partial<HyperliquidSyncConfig>,
): Promise<HyperliquidSyncResult> {
  if (syncInFlight) {
    return {
      ts: Date.now(),
      topN: 0,
      candleInterval: "1h",
      candleLookbackDays: 0,
      coins: [],
      candlesFetched: 0,
      metricsUpdated: 0,
    };
  }

  syncInFlight = true;
  try {
    const config: HyperliquidSyncConfig = {
      topN: cfg?.topN ?? envNumber("BSM_SYNC_TOP_N", 25),
      candleInterval: cfg?.candleInterval ?? process.env.BSM_CANDLE_INTERVAL ?? "1h",
      candleLookbackDays: cfg?.candleLookbackDays ?? envNumber("BSM_CANDLE_LOOKBACK_DAYS", 30),
      candleRefreshMinutes: cfg?.candleRefreshMinutes ?? envNumber("BSM_CANDLE_REFRESH_MINUTES", 30),
      concurrency: cfg?.concurrency ?? envNumber("BSM_SYNC_CONCURRENCY", 6),
    };

    const seconds = intervalToSeconds(config.candleInterval);
    if (!seconds) throw new Error(`Unsupported candle interval: ${config.candleInterval}`);

    const db = getDb();
    const now = Date.now();
    const startTime = now - config.candleLookbackDays * MS_PER_DAY;
    const candleRefreshMs = config.candleRefreshMinutes * 60_000;

    const [meta, ctxs] = await getMetaAndAssetCtxs();
    const combined = meta.universe.map((asset, idx) => ({ asset, ctx: ctxs[idx] }));

    const rows = combined
      .filter(({ asset }) => !asset.isDelisted)
      .filter(({ asset }) => /^[A-Z0-9]{2,10}$/.test(asset.name))
      .map(({ asset, ctx }) => ({
        asset,
        ctx,
        dayNtlVlm: toNumber(ctx.dayNtlVlm) ?? 0,
      }))
      .sort((a, b) => b.dayNtlVlm - a.dayNtlVlm)
      .slice(0, config.topN);

    const upsertAsset = db.prepare(`
      INSERT INTO assets(symbol, sz_decimals, max_leverage, margin_table_id, is_delisted, updated_at)
      VALUES(?, ?, ?, ?, ?, ?)
      ON CONFLICT(symbol) DO UPDATE SET
        sz_decimals=excluded.sz_decimals,
        max_leverage=excluded.max_leverage,
        margin_table_id=excluded.margin_table_id,
        is_delisted=excluded.is_delisted,
        updated_at=excluded.updated_at
    `);

    const upsertCtx = db.prepare(`
      INSERT INTO asset_ctx_latest(
        symbol, ts, mid_px, mark_px, oracle_px, prev_day_px,
        day_ntl_vlm, day_base_vlm, open_interest, funding, premium
      )
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(symbol) DO UPDATE SET
        ts=excluded.ts,
        mid_px=excluded.mid_px,
        mark_px=excluded.mark_px,
        oracle_px=excluded.oracle_px,
        prev_day_px=excluded.prev_day_px,
        day_ntl_vlm=excluded.day_ntl_vlm,
        day_base_vlm=excluded.day_base_vlm,
        open_interest=excluded.open_interest,
        funding=excluded.funding,
        premium=excluded.premium
    `);

    const candleStateGet = db.prepare(
      `SELECT fetched_at FROM candle_fetch_state WHERE symbol=? AND interval=?`,
    );
    const candleStateUpsert = db.prepare(`
      INSERT INTO candle_fetch_state(symbol, interval, fetched_at, end_time)
      VALUES(?, ?, ?, ?)
      ON CONFLICT(symbol, interval) DO UPDATE SET
        fetched_at=excluded.fetched_at,
        end_time=excluded.end_time
    `);

    const candleUpsert = db.prepare(`
      INSERT INTO candles(symbol, interval, t, t_end, o, c, h, l, v, n)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(symbol, interval, t) DO UPDATE SET
        t_end=excluded.t_end,
        o=excluded.o,
        c=excluded.c,
        h=excluded.h,
        l=excluded.l,
        v=excluded.v,
        n=excluded.n
    `);

    const candleCloses = db.prepare(
      `SELECT c FROM candles WHERE symbol=? AND interval=? AND t>=? ORDER BY t ASC`,
    );

    const metricsUpsert = db.prepare(`
      INSERT INTO market_metrics_latest(
        symbol, ts, mid, prev_day_px, day_ntl_vlm, realized_vol,
        sigma_move_24h, tail_prob_24h, ret_24h
      )
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(symbol) DO UPDATE SET
        ts=excluded.ts,
        mid=excluded.mid,
        prev_day_px=excluded.prev_day_px,
        day_ntl_vlm=excluded.day_ntl_vlm,
        realized_vol=excluded.realized_vol,
        sigma_move_24h=excluded.sigma_move_24h,
        tail_prob_24h=excluded.tail_prob_24h,
        ret_24h=excluded.ret_24h
    `);

    const syncStateUpsert = db.prepare(`
      INSERT INTO sync_state(key, value, updated_at)
      VALUES(?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value=excluded.value,
        updated_at=excluded.updated_at
    `);

    for (const { asset, ctx } of rows) {
      upsertAsset.run(
        asset.name,
        asset.szDecimals,
        asset.maxLeverage,
        asset.marginTableId,
        asset.isDelisted ? 1 : 0,
        now,
      );

      upsertCtx.run(
        asset.name,
        now,
        toNumber(ctx.midPx),
        toNumber(ctx.markPx),
        toNumber(ctx.oraclePx),
        toNumber(ctx.prevDayPx),
        toNumber(ctx.dayNtlVlm),
        toNumber(ctx.dayBaseVlm),
        toNumber(ctx.openInterest),
        toNumber(ctx.funding),
        toNumber(ctx.premium),
      );
    }

    let candlesFetched = 0;

    await mapLimit(rows, config.concurrency, async ({ asset }) => {
      const last = candleStateGet.get(asset.name, config.candleInterval) as
        | { fetched_at: number }
        | undefined;

      const shouldFetch = !last || now - last.fetched_at > candleRefreshMs;
      if (!shouldFetch) return;

      const candles = await getCandleSnapshot({
        coin: asset.name,
        interval: config.candleInterval,
        startTime,
        endTime: now,
      });

      for (const c of candles) {
        candleUpsert.run(
          asset.name,
          config.candleInterval,
          c.t,
          c.T,
          Number(c.o),
          Number(c.c),
          Number(c.h),
          Number(c.l),
          Number(c.v),
          c.n,
        );
      }

      candleStateUpsert.run(asset.name, config.candleInterval, now, now);
      candlesFetched += candles.length;
    });

    let metricsUpdated = 0;
    for (const { asset, ctx, dayNtlVlm } of rows) {
      const mid = toNumber(ctx.midPx) ?? toNumber(ctx.markPx) ?? toNumber(ctx.oraclePx);
      if (!mid) continue;

      const prevDayPx = toNumber(ctx.prevDayPx);
      const closes = (candleCloses.all(asset.name, config.candleInterval, startTime) as Array<{ c: number }>).map(
        (r) => r.c,
      );

      const sigma = realizedVol({ closes, periodSeconds: seconds });
      const ret24h =
        prevDayPx && prevDayPx > 0 ? mid / prevDayPx - 1 : null;

      const sigmaMove =
        prevDayPx && prevDayPx > 0 && sigma && sigma > 0
          ? Math.log(mid / prevDayPx) / (sigma * Math.sqrt(1 / 365))
          : null;

      const tailProb =
        sigmaMove === null
          ? null
          : 2 * (1 - normCdf(Math.abs(sigmaMove)));

      metricsUpsert.run(
        asset.name,
        now,
        mid,
        prevDayPx,
        dayNtlVlm,
        sigma,
        sigmaMove,
        tailProb,
        ret24h,
      );
      metricsUpdated += 1;
    }

    syncStateUpsert.run("last_hyperliquid_sync", String(now), now);

    return {
      ts: now,
      topN: config.topN,
      candleInterval: config.candleInterval,
      candleLookbackDays: config.candleLookbackDays,
      coins: rows.map((r) => r.asset.name),
      candlesFetched,
      metricsUpdated,
    };
  } finally {
    syncInFlight = false;
  }
}
