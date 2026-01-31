import "server-only";

import { getDb } from "@/lib/server/db";
import { computePerpContrarianSignal, healthForPositionFromSignal } from "@/lib/strategy/perp-signal";

export type PositionSide = "long" | "short";
export type PositionStatus = "open" | "closed";

export type PositionRow = {
  id: number;
  symbol: string;
  side: PositionSide;
  notional: number;
  qty: number;
  entry_px: number;
  entry_ts: number;
  status: PositionStatus;
  exit_px: number | null;
  exit_ts: number | null;
  closed_pnl: number | null;
  meta_json: string | null;
  updated_at: number;
};

export type OpenPositionView = PositionRow & {
  current_px: number | null;
  current_ts: number | null;
  realized_vol: number | null;
  sigma_move_24h: number | null;
  tail_prob_24h: number | null;
  ret_24h: number | null;
  funding: number | null;
  premium: number | null;
  pnl: number | null;
  value: number | null;
  pnl_pct: number | null;
  health_score: number | null; // [-1, +1], positive means aligned with signal
  health_label: string | null;
  health_action: "hold" | "review" | "exit" | "exit_now" | null;
};

export type PositionHealth = {
  score: number | null;
  label: string | null;
  action: "hold" | "review" | "exit" | "exit_now" | null;
};

function toNumber(v: unknown) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function markToMarket(opts: {
  side: PositionSide;
  notional: number;
  qty: number;
  entryPx: number;
  currentPx: number;
}) {
  const dir = opts.side === "long" ? 1 : -1;
  const pnl = (opts.currentPx - opts.entryPx) * opts.qty * dir;
  const value = opts.notional + pnl;
  const pnlPct = opts.notional === 0 ? null : pnl / opts.notional;
  return { pnl, value, pnlPct };
}

export function positionHealth(opts: {
  side: PositionSide;
  sigmaMove24h: number | null;
  fundingRate?: number | null;
  premium?: number | null;
}): PositionHealth {
  const signal = computePerpContrarianSignal({
    sigmaMove24h: opts.sigmaMove24h,
    fundingRate: opts.fundingRate ?? null,
    premium: opts.premium ?? null,
  });
  return healthForPositionFromSignal({ positionSide: opts.side, signal });
}

function getLatestMid(symbol: string) {
  const db = getDb();
  const row = db
    .prepare(`SELECT mid, ts FROM market_metrics_latest WHERE symbol=?`)
    .get(symbol) as { mid: number; ts: number } | undefined;

  if (row && toNumber(row.mid) !== null) return { mid: row.mid, ts: row.ts };

  const fallback = db
    .prepare(`SELECT mid_px AS mid, ts FROM asset_ctx_latest WHERE symbol=?`)
    .get(symbol) as { mid: number | null; ts: number } | undefined;

  if (fallback && toNumber(fallback.mid) !== null && fallback.mid !== null) {
    return { mid: fallback.mid, ts: fallback.ts };
  }

  return null;
}

export function listOpenPositions(): OpenPositionView[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT
         p.id, p.symbol, p.side, p.notional, p.qty, p.entry_px, p.entry_ts,
         p.status, p.exit_px, p.exit_ts, p.closed_pnl, p.meta_json, p.updated_at,
         COALESCE(m.mid, c.mid_px) AS current_px,
         COALESCE(m.ts, c.ts) AS current_ts,
         m.realized_vol,
         m.sigma_move_24h,
         m.tail_prob_24h,
         m.ret_24h,
         c.funding,
         c.premium
       FROM positions p
       LEFT JOIN market_metrics_latest m ON m.symbol = p.symbol
       LEFT JOIN asset_ctx_latest c ON c.symbol = p.symbol
       WHERE p.status='open'
       ORDER BY p.updated_at DESC`,
    )
    .all() as Array<
      PositionRow & {
        current_px: number | null;
        current_ts: number | null;
        realized_vol: number | null;
        sigma_move_24h: number | null;
        tail_prob_24h: number | null;
        ret_24h: number | null;
        funding: number | null;
        premium: number | null;
      }
    >;

  return rows.map((r) => {
    const currentPx = toNumber(r.current_px);
    const sigmaMove = toNumber(r.sigma_move_24h);
    const funding = toNumber(r.funding);
    const premium = toNumber(r.premium);
    const { score, label, action } = positionHealth({
      side: r.side,
      sigmaMove24h: sigmaMove,
      fundingRate: funding,
      premium,
    });

    if (currentPx === null || currentPx <= 0) {
      return {
        ...r,
        sigma_move_24h: sigmaMove,
        realized_vol: toNumber(r.realized_vol),
        tail_prob_24h: toNumber(r.tail_prob_24h),
        ret_24h: toNumber(r.ret_24h),
        funding,
        premium,
        pnl: null,
        value: null,
        pnl_pct: null,
        health_score: score,
        health_label: label,
        health_action: action,
      };
    }

    const res = markToMarket({
      side: r.side,
      notional: r.notional,
      qty: r.qty,
      entryPx: r.entry_px,
      currentPx,
    });

    return {
      ...r,
      sigma_move_24h: sigmaMove,
      realized_vol: toNumber(r.realized_vol),
      tail_prob_24h: toNumber(r.tail_prob_24h),
      ret_24h: toNumber(r.ret_24h),
      funding,
      premium,
      pnl: res.pnl,
      value: res.value,
      pnl_pct: res.pnlPct,
      health_score: score,
      health_label: label,
      health_action: action,
    };
  });
}

export function openPosition(opts: {
  symbol: string;
  side: PositionSide;
  notional: number;
  qty?: number;
  entryPx?: number;
  entryTs?: number;
  meta?: Record<string, unknown>;
}) {
  const symbol = opts.symbol.toUpperCase();
  if (!/^[A-Z0-9]{2,10}$/.test(symbol)) throw new Error("Invalid symbol");
  if (opts.side !== "long" && opts.side !== "short") throw new Error("Invalid side");

  const notional = toNumber(opts.notional);
  if (notional === null || notional <= 0) throw new Error("Notional must be > 0");

  const db = getDb();

  const existing = db
    .prepare(`SELECT id FROM positions WHERE symbol=? AND status='open' LIMIT 1`)
    .get(symbol) as { id: number } | undefined;
  if (existing) throw new Error(`Position already open for ${symbol}`);

  const explicitEntryPx = toNumber(opts.entryPx);
  const explicitQty = toNumber(opts.qty);
  const explicitEntryTs = toNumber(opts.entryTs);

  const mid = explicitEntryPx ? null : getLatestMid(symbol);
  if (!explicitEntryPx) {
    if (!mid || !Number.isFinite(mid.mid) || mid.mid <= 0) {
      throw new Error(`No mid price for ${symbol}. Sync DB first.`);
    }
  }

  const entryPx = explicitEntryPx ?? (mid ? mid.mid : null);
  if (entryPx === null || entryPx <= 0) throw new Error("Invalid entry price");

  const qty = explicitQty ?? notional / entryPx;
  if (!Number.isFinite(qty) || qty <= 0) throw new Error("Invalid qty");

  const now = Date.now();
  const entryTs = explicitEntryTs ?? now;
  const metaJson = opts.meta ? JSON.stringify(opts.meta) : null;

  const ins = db.prepare(`
    INSERT INTO positions(
      symbol, side, notional, qty, entry_px, entry_ts,
      status, exit_px, exit_ts, closed_pnl, meta_json, updated_at
    )
    VALUES(?, ?, ?, ?, ?, ?, 'open', NULL, NULL, NULL, ?, ?)
  `);

  const res = ins.run(symbol, opts.side, notional, qty, entryPx, entryTs, metaJson, now);
  const id = Number(res.lastInsertRowid);

  const row = db
    .prepare(
      `SELECT id, symbol, side, notional, qty, entry_px, entry_ts, status, exit_px, exit_ts, closed_pnl, meta_json, updated_at
       FROM positions WHERE id=?`,
    )
    .get(id) as PositionRow | undefined;

  if (!row) throw new Error("Failed to create position");
  return row;
}

export function getPositionById(id: number) {
  const db = getDb();
  const pos = db
    .prepare(
      `SELECT id, symbol, side, notional, qty, entry_px, entry_ts, status, exit_px, exit_ts, closed_pnl, meta_json, updated_at
       FROM positions WHERE id=?`,
    )
    .get(id) as PositionRow | undefined;
  return pos ?? null;
}

export function closePositionWithExit(opts: { id: number; exitPx: number; exitTs?: number }) {
  const db = getDb();
  const pos = getPositionById(opts.id);
  if (!pos) throw new Error("Position not found");
  if (pos.status !== "open") throw new Error("Position is not open");

  const exitPx = toNumber(opts.exitPx);
  if (exitPx === null || exitPx <= 0) throw new Error("Invalid exit price");

  const { pnl } = markToMarket({
    side: pos.side,
    notional: pos.notional,
    qty: pos.qty,
    entryPx: pos.entry_px,
    currentPx: exitPx,
  });

  const now = Date.now();
  const exitTs = toNumber(opts.exitTs) ?? now;

  db.prepare(
    `UPDATE positions
     SET status='closed', exit_px=?, exit_ts=?, closed_pnl=?, updated_at=?
     WHERE id=? AND status='open'`,
  ).run(exitPx, exitTs, pnl, now, opts.id);

  const updated = getPositionById(opts.id);
  if (!updated) throw new Error("Failed to close position");
  return updated;
}

export function closePosition(id: number) {
  const db = getDb();
  const pos = db
    .prepare(
      `SELECT id, symbol, side, notional, qty, entry_px, entry_ts, status, exit_px, exit_ts, closed_pnl, meta_json, updated_at
       FROM positions WHERE id=?`,
    )
    .get(id) as PositionRow | undefined;

  if (!pos) throw new Error("Position not found");
  if (pos.status !== "open") throw new Error("Position is not open");

  const mid = getLatestMid(pos.symbol);
  if (!mid || !Number.isFinite(mid.mid) || mid.mid <= 0) {
    throw new Error(`No mid price for ${pos.symbol}. Sync DB first.`);
  }

  const { pnl } = markToMarket({
    side: pos.side,
    notional: pos.notional,
    qty: pos.qty,
    entryPx: pos.entry_px,
    currentPx: mid.mid,
  });

  const now = Date.now();
  db.prepare(
    `UPDATE positions
     SET status='closed', exit_px=?, exit_ts=?, closed_pnl=?, updated_at=?
     WHERE id=? AND status='open'`,
  ).run(mid.mid, now, pnl, now, id);

  const updated = db
    .prepare(
      `SELECT id, symbol, side, notional, qty, entry_px, entry_ts, status, exit_px, exit_ts, closed_pnl, meta_json, updated_at
       FROM positions WHERE id=?`,
    )
    .get(id) as PositionRow | undefined;

  if (!updated) throw new Error("Failed to close position");
  return updated;
}
