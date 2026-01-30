import { describe, expect, it } from "vitest";

import { realizedVol } from "@/lib/quant/vol";

describe("realizedVol", () => {
  it("returns ~0 for a flat price series", () => {
    const sigma = realizedVol({ closes: [100, 100, 100, 100], periodSeconds: 3600 });
    expect(sigma).not.toBeNull();
    expect(sigma!).toBeCloseTo(0, 12);
  });
});

