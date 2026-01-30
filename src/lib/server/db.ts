import "server-only";

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

declare global {
  var __bsmDb: DatabaseSync | undefined;
}

function resolveDbPath() {
  const raw =
    process.env.BSM_DB_PATH ?? path.join(process.cwd(), "data", "bsm.sqlite");
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

function ensureSchema(db: DatabaseSync) {
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA synchronous=NORMAL;

    CREATE TABLE IF NOT EXISTS sync_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS assets (
      symbol TEXT PRIMARY KEY,
      sz_decimals INTEGER NOT NULL,
      max_leverage INTEGER NOT NULL,
      margin_table_id INTEGER NOT NULL,
      is_delisted INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS asset_ctx_latest (
      symbol TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      mid_px REAL,
      mark_px REAL,
      oracle_px REAL,
      prev_day_px REAL,
      day_ntl_vlm REAL,
      day_base_vlm REAL,
      open_interest REAL,
      funding REAL,
      premium REAL
    );

    CREATE TABLE IF NOT EXISTS candle_fetch_state (
      symbol TEXT NOT NULL,
      interval TEXT NOT NULL,
      fetched_at INTEGER NOT NULL,
      end_time INTEGER NOT NULL,
      PRIMARY KEY(symbol, interval)
    );

    CREATE TABLE IF NOT EXISTS candles (
      symbol TEXT NOT NULL,
      interval TEXT NOT NULL,
      t INTEGER NOT NULL,
      t_end INTEGER NOT NULL,
      o REAL NOT NULL,
      c REAL NOT NULL,
      h REAL NOT NULL,
      l REAL NOT NULL,
      v REAL NOT NULL,
      n INTEGER NOT NULL,
      PRIMARY KEY(symbol, interval, t)
    );

    CREATE TABLE IF NOT EXISTS market_metrics_latest (
      symbol TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      mid REAL NOT NULL,
      prev_day_px REAL,
      day_ntl_vlm REAL,
      realized_vol REAL,
      sigma_move_24h REAL,
      tail_prob_24h REAL,
      ret_24h REAL
    );

    CREATE TABLE IF NOT EXISTS positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL CHECK(side IN ('long','short')),
      notional REAL NOT NULL,
      qty REAL NOT NULL,
      entry_px REAL NOT NULL,
      entry_ts INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
      exit_px REAL,
      exit_ts INTEGER,
      closed_pnl REAL,
      meta_json TEXT,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_positions_status_updated_at
      ON positions(status, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_market_metrics_day_ntl_vlm
      ON market_metrics_latest(day_ntl_vlm DESC);
  `);
}

export function getDb() {
  if (globalThis.__bsmDb) {
    // During Next dev/HMR the cached DB connection can outlive module reloads,
    // so ensure we always have the latest schema (CREATE IF NOT EXISTS is safe).
    ensureSchema(globalThis.__bsmDb);
    return globalThis.__bsmDb;
  }

  const dbPath = resolveDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new DatabaseSync(dbPath);
  ensureSchema(db);

  globalThis.__bsmDb = db;
  return db;
}
