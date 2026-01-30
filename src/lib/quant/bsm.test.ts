import { describe, expect, it } from "vitest";

import { bsmPrice, impliedVol } from "@/lib/quant/bsm";

describe("bsmPrice", () => {
  it("matches a standard reference point (S=K=100, T=1, r=5%, sigma=20%)", () => {
    const inputs = { S: 100, K: 100, T: 1, r: 0.05, sigma: 0.2 };

    const call = bsmPrice(inputs, "call");
    const put = bsmPrice(inputs, "put");

    expect(call).toBeCloseTo(10.4506, 3);
    expect(put).toBeCloseTo(5.5735, 3);
  });

  it("satisfies call-put parity (with q)", () => {
    const inputs = { S: 250, K: 275, T: 0.75, r: 0.03, q: 0.015, sigma: 0.55 };
    const call = bsmPrice(inputs, "call");
    const put = bsmPrice(inputs, "put");
    const parity = inputs.S * Math.exp(-inputs.q * inputs.T) - inputs.K * Math.exp(-inputs.r * inputs.T);

    expect(call - put).toBeCloseTo(parity, 8);
  });
});

describe("impliedVol", () => {
  it("recovers sigma from the option price", () => {
    const base = { S: 100, K: 115, T: 0.4, r: 0.02, q: 0.01 };
    const sigma = 0.37;
    const price = bsmPrice({ ...base, sigma }, "call");
    const iv = impliedVol({ ...base, price, right: "call" });

    expect(iv).not.toBeNull();
    expect(iv!).toBeCloseTo(sigma, 6);
  });
});

