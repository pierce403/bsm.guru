import { describe, expect, it } from "vitest";

import { midFromBidAsk, pickClosestExpiryTs, pickNearestStrike } from "@/lib/options/deribit";

describe("midFromBidAsk", () => {
  it("prefers mid when bid+ask are present", () => {
    expect(midFromBidAsk({ bid: 10, ask: 14, mark: 12 })).toBe(12);
  });

  it("falls back to mark when no bid/ask", () => {
    expect(midFromBidAsk({ bid: null, ask: null, mark: 5 })).toBe(5);
  });

  it("falls back to bid or ask when mark missing", () => {
    expect(midFromBidAsk({ bid: 7, ask: null, mark: null })).toBe(7);
    expect(midFromBidAsk({ bid: null, ask: 9, mark: null })).toBe(9);
  });
});

describe("pickClosestExpiryTs", () => {
  it("picks the expiry closest to the target while respecting minTs", () => {
    const now = 1_000_000;
    const expiries = [now + 1, now + 10, now + 100, now + 1000];
    const targetTs = now + 95;
    const minTs = now + 5;

    expect(
      pickClosestExpiryTs({ expiryTimestamps: expiries, targetTs, minTs }),
    ).toBe(now + 100);
  });

  it("returns null when everything is before minTs", () => {
    expect(
      pickClosestExpiryTs({
        expiryTimestamps: [10, 20, 30],
        targetTs: 25,
        minTs: 100,
      }),
    ).toBeNull();
  });
});

describe("pickNearestStrike", () => {
  it("picks the strike nearest to spot", () => {
    expect(pickNearestStrike([80, 100, 120], 111)).toBe(120);
    expect(pickNearestStrike([80, 100, 120], 99)).toBe(100);
  });

  it("returns null for empty/invalid input", () => {
    expect(pickNearestStrike([], 100)).toBeNull();
    expect(pickNearestStrike([NaN, -1], 100)).toBeNull();
  });
});

