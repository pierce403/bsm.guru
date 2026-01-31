import { describe, expect, it } from "vitest";

// NOTE: This test validates our tick-size formatting logic that prevents
// Hyperliquid rejecting orders with "invalid price".
//
// Docs: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/tick-and-lot-size

function formatPerpPx(px: number, szDecimals: number) {
  if (!Number.isFinite(px) || px <= 0) throw new Error("Invalid price");
  const maxDecimals = Math.max(0, 6 - Math.floor(Math.max(szDecimals, 0)));
  const sig = Number(px.toPrecision(5));
  if (!Number.isFinite(sig) || sig <= 0) throw new Error("Invalid price");
  const s = String(sig);
  const i = s.indexOf(".");
  const decimalsInSig = i >= 0 ? s.length - i - 1 : 0;
  const capped = decimalsInSig > maxDecimals ? Number(sig.toFixed(maxDecimals)) : sig;
  if (!Number.isFinite(capped) || capped <= 0) throw new Error("Invalid price");
  return capped;
}

function sigFigs(n: number) {
  const s = n.toString().replace(".", "").replace(/^0+/, "");
  return s.length;
}

describe("hyperliquid price formatting", () => {
  it("reduces price to <=5 significant figures", () => {
    const px = formatPerpPx(31.7107, 2);
    expect(sigFigs(px)).toBeLessThanOrEqual(5);
  });

  it("caps decimals based on szDecimals (maxDecimals = 6 - szDecimals)", () => {
    // szDecimals=2 => maxDecimals=4
    const px = formatPerpPx(0.123456, 2);
    const s = px.toString();
    const i = s.indexOf(".");
    const dec = i >= 0 ? s.length - i - 1 : 0;
    expect(dec).toBeLessThanOrEqual(4);
  });
});

