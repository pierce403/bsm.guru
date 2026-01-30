import { describe, expect, it } from "vitest";

import { markToMarket } from "@/lib/server/positions";

describe("markToMarket", () => {
  it("computes long PnL and value", () => {
    const { pnl, value, pnlPct } = markToMarket({
      side: "long",
      notional: 1000,
      qty: 1,
      entryPx: 100,
      currentPx: 110,
    });

    expect(pnl).toBeCloseTo(10);
    expect(value).toBeCloseTo(1010);
    expect(pnlPct).toBeCloseTo(0.01);
  });

  it("computes short PnL and value", () => {
    const { pnl, value, pnlPct } = markToMarket({
      side: "short",
      notional: 1000,
      qty: 2,
      entryPx: 50,
      currentPx: 45,
    });

    expect(pnl).toBeCloseTo(10);
    expect(value).toBeCloseTo(1010);
    expect(pnlPct).toBeCloseTo(0.01);
  });

  it("returns null pnlPct when notional is zero", () => {
    const { pnlPct } = markToMarket({
      side: "long",
      notional: 0,
      qty: 1,
      entryPx: 100,
      currentPx: 110,
    });

    expect(pnlPct).toBeNull();
  });
});

