import { describe, expect, it } from "vitest";

import { markToMarket, positionHealth } from "@/lib/server/positions";

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

describe("positionHealth", () => {
  it("marks an aligned position as strong/good", () => {
    // z<0 implies contrarian long.
    const h = positionHealth({ side: "long", sigmaMove24h: -2 });
    expect(h.action).toBe("hold");
    expect(["Good", "Strong"]).toContain(h.label);
    expect(h.score).toBeGreaterThan(0);
  });

  it("recommends exiting when edge is gone", () => {
    const h = positionHealth({ side: "long", sigmaMove24h: -0.2 });
    expect(h.action).toBe("exit");
    expect(h.label).toBe("Edge gone");
  });

  it("recommends exiting immediately when the signal flips strongly", () => {
    // z>0 implies contrarian short; long is misaligned.
    const h = positionHealth({ side: "long", sigmaMove24h: 1.1 });
    expect(h.action).toBe("exit_now");
    expect(h.label).toBe("Exit now");
    expect(h.score).toBeLessThan(0);
  });
});
