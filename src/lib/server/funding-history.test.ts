import { beforeEach, describe, expect, it } from "vitest";

import { getDb } from "@/lib/server/db";
import { ensureFundingHistory, loadFundingHistoryFromDb } from "@/lib/server/funding-history";

function resetDb(dbPath: string) {
  // Reset the cached sqlite connection between tests so BSM_DB_PATH is honored.
  (globalThis as unknown as { __bsmDb?: unknown }).__bsmDb = undefined;
  process.env.BSM_DB_PATH = dbPath;
}

describe("funding-history caching", () => {
  beforeEach(() => {
    resetDb(`logs/_vitest/funding-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`);
  });

  it("fetches and caches funding history when missing", async () => {
    const symbol = "ETH";
    const startTime = Date.now() - 6 * 60 * 60 * 1000;
    const endTime = Date.now();

    let calls = 0;
    const res = await ensureFundingHistory({
      symbol,
      startTime,
      endTime,
      fetcher: async () => {
        calls += 1;
        return [
          { coin: symbol, time: startTime + 60 * 60 * 1000, fundingRate: "0.0001", premium: "0.001" },
          { coin: symbol, time: startTime + 2 * 60 * 60 * 1000, fundingRate: "0.0002", premium: "0.002" },
        ];
      },
    });

    expect(res.fetched).toBe(true);
    expect(calls).toBe(1);

    const pts = loadFundingHistoryFromDb({ symbol, startTime, endTime });
    expect(pts.length).toBe(2);
    expect(pts[0]!.fundingRate).toBeCloseTo(0.0001);
    expect(pts[1]!.premium).toBeCloseTo(0.002);
  });

  it("does not fetch when DB coverage exists for the requested range", async () => {
    const symbol = "ETH";
    const startTime = Date.now() - 4 * 60 * 60 * 1000;
    const endTime = Date.now();

    // Seed DB with entries that cover the full range (within default tolerance).
    const db = getDb();
    const upsert = db.prepare(
      `INSERT INTO funding_history(symbol, time, funding_rate, premium)
       VALUES(?, ?, ?, ?)
       ON CONFLICT(symbol, time) DO UPDATE SET
         funding_rate=excluded.funding_rate,
         premium=excluded.premium`,
    );
    upsert.run(symbol, startTime, 0.0001, 0.001);
    upsert.run(symbol, endTime, 0.0001, 0.001);

    let calls = 0;
    const res = await ensureFundingHistory({
      symbol,
      startTime,
      endTime,
      fetcher: async () => {
        calls += 1;
        return [];
      },
    });

    expect(res.fetched).toBe(false);
    expect(calls).toBe(0);
  });
});

