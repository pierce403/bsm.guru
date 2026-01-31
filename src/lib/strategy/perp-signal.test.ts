import { describe, expect, it } from "vitest";

import {
  computePerpContrarianSignal,
  healthForPositionFromSignal,
} from "@/lib/strategy/perp-signal";

describe("perp-signal", () => {
  it("returns null when sigmaMove24h is missing", () => {
    expect(computePerpContrarianSignal({ sigmaMove24h: null })).toBeNull();
  });

  it("chooses the contrarian side based on sigma move sign", () => {
    const up = computePerpContrarianSignal({ sigmaMove24h: 1.2 });
    const down = computePerpContrarianSignal({ sigmaMove24h: -1.2 });
    expect(up?.side).toBe("short");
    expect(down?.side).toBe("long");
  });

  it("scores aligned funding/premium higher than adverse funding/premium", () => {
    const base = { sigmaMove24h: 2.0, dayNtlVlm: 1_000_000 };

    const aligned = computePerpContrarianSignal({
      ...base,
      fundingRate: 0.0005, // +5 bps (longs pay shorts) -> aligns with short
      premium: 0.002, // +20 bps -> aligns with short
    });
    const adverse = computePerpContrarianSignal({
      ...base,
      fundingRate: -0.0005,
      premium: -0.002,
    });

    expect(aligned).not.toBeNull();
    expect(adverse).not.toBeNull();
    expect(aligned!.score).toBeGreaterThan(adverse!.score);
  });

  it("health exits quickly when a position is opposite the current signal", () => {
    const sig = computePerpContrarianSignal({
      sigmaMove24h: 2.3, // suggests short
      fundingRate: 0.0004,
      premium: 0.001,
    });
    const h = healthForPositionFromSignal({ positionSide: "long", signal: sig });
    expect(h.action).toBe("exit_now");
  });

  it("health holds when aligned and signal remains strong", () => {
    const sig = computePerpContrarianSignal({
      sigmaMove24h: 2.3, // suggests short
      fundingRate: 0.0004,
      premium: 0.001,
    });
    const h = healthForPositionFromSignal({ positionSide: "short", signal: sig });
    expect(h.action).toBe("hold");
  });
});

