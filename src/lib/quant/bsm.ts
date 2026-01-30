import { normCdf, normPdf } from "@/lib/quant/normal";

export type OptionRight = "call" | "put";

export type BsmInputs = {
  S: number; // spot
  K: number; // strike
  T: number; // time to expiry in years
  sigma: number; // annualized volatility
  r: number; // continuously-compounded risk-free rate
  q?: number; // continuously-compounded dividend/borrow/yield
};

export type BsmResult = {
  right: OptionRight;
  price: number;
  delta: number;
  gamma: number;
  vega: number; // per 1.00 vol (not 1%)
  theta: number; // per year
  rho: number; // per 1.00 rate (not 1%)
  d1: number;
  d2: number;
};

function assertInputs({ S, K, T, sigma }: BsmInputs) {
  if (!Number.isFinite(S) || S <= 0) throw new Error("S must be > 0");
  if (!Number.isFinite(K) || K <= 0) throw new Error("K must be > 0");
  if (!Number.isFinite(T) || T < 0) throw new Error("T must be >= 0");
  if (!Number.isFinite(sigma) || sigma < 0) throw new Error("sigma must be >= 0");
}

export function bsmD1D2(inputs: BsmInputs) {
  assertInputs(inputs);
  const { S, K, T, sigma, r, q = 0 } = inputs;
  if (T === 0 || sigma === 0) return { d1: NaN, d2: NaN };
  const vsqrt = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / vsqrt;
  const d2 = d1 - vsqrt;
  return { d1, d2 };
}

export function bsmPrice(inputs: BsmInputs, right: OptionRight) {
  assertInputs(inputs);
  const { S, K, T, sigma, r, q = 0 } = inputs;

  if (T === 0) {
    const intrinsic = right === "call" ? Math.max(S - K, 0) : Math.max(K - S, 0);
    return intrinsic;
  }

  if (sigma === 0) {
    // Deterministic forward under continuous rates. (European option)
    const fwd = S * Math.exp((r - q) * T);
    const disc = Math.exp(-r * T);
    const payoff = right === "call" ? Math.max(fwd - K, 0) : Math.max(K - fwd, 0);
    return disc * payoff;
  }

  const { d1, d2 } = bsmD1D2(inputs);
  const dfq = Math.exp(-q * T);
  const dfr = Math.exp(-r * T);

  if (right === "call") return S * dfq * normCdf(d1) - K * dfr * normCdf(d2);
  return K * dfr * normCdf(-d2) - S * dfq * normCdf(-d1);
}

export function bsm(inputs: BsmInputs, right: OptionRight): BsmResult {
  assertInputs(inputs);
  const { S, K, T, sigma, r, q = 0 } = inputs;

  const dfq = Math.exp(-q * T);
  const dfr = Math.exp(-r * T);

  if (T === 0) {
    const intrinsic = right === "call" ? Math.max(S - K, 0) : Math.max(K - S, 0);
    const delta =
      right === "call" ? (S > K ? 1 : 0) : S < K ? -1 : 0;
    return {
      right,
      price: intrinsic,
      delta,
      gamma: 0,
      vega: 0,
      theta: 0,
      rho: 0,
      d1: NaN,
      d2: NaN,
    };
  }

  if (sigma === 0) {
    const price = bsmPrice(inputs, right);
    // Greeks are not well-behaved at sigma=0; return finite-ish zeros.
    return {
      right,
      price,
      delta: right === "call" ? dfq : -dfq,
      gamma: 0,
      vega: 0,
      theta: 0,
      rho: 0,
      d1: NaN,
      d2: NaN,
    };
  }

  const { d1, d2 } = bsmD1D2(inputs);
  const sqrtT = Math.sqrt(T);
  const pdf1 = normPdf(d1);

  const Nd1 = normCdf(d1);
  const Nd2 = normCdf(d2);

  const price =
    right === "call"
      ? S * dfq * Nd1 - K * dfr * Nd2
      : K * dfr * normCdf(-d2) - S * dfq * normCdf(-d1);

  const delta =
    right === "call" ? dfq * Nd1 : dfq * (Nd1 - 1);

  const gamma = (dfq * pdf1) / (S * sigma * sqrtT);

  const vega = S * dfq * pdf1 * sqrtT;

  // Theta here is per year (not per day).
  const thetaCommon = -(S * dfq * pdf1 * sigma) / (2 * sqrtT);
  const theta =
    right === "call"
      ? thetaCommon - r * K * dfr * Nd2 + q * S * dfq * Nd1
      : thetaCommon + r * K * dfr * normCdf(-d2) - q * S * dfq * normCdf(-d1);

  const rho =
    right === "call"
      ? K * T * dfr * Nd2
      : -K * T * dfr * normCdf(-d2);

  return { right, price, delta, gamma, vega, theta, rho, d1, d2 };
}

export type ImpliedVolParams = Omit<BsmInputs, "sigma"> & {
  right: OptionRight;
  price: number;
};

export function impliedVol({
  S,
  K,
  T,
  r,
  q,
  right,
  price,
}: ImpliedVolParams) {
  if (!Number.isFinite(price) || price < 0) return null;
  if (T === 0) return 0;

  // Cheap no-arbitrage bounds. (European, continuous rates)
  const dfq = Math.exp(-(q ?? 0) * T);
  const dfr = Math.exp(-r * T);
  const intrinsic =
    right === "call"
      ? Math.max(S * dfq - K * dfr, 0)
      : Math.max(K * dfr - S * dfq, 0);

  const upper = right === "call" ? S * dfq : K * dfr;
  if (price < intrinsic - 1e-12 || price > upper + 1e-12) return null;

  // Bisection is slower than Newton-Raphson but far more robust.
  let lo = 1e-6;
  let hi = 4.0;

  const target = price;
  const f = (sigma: number) =>
    bsmPrice({ S, K, T, sigma, r, q }, right) - target;

  let flo = f(lo);
  let fhi = f(hi);
  while (flo * fhi > 0 && hi < 10) {
    hi *= 1.5;
    fhi = f(hi);
  }
  if (flo * fhi > 0) return null;

  for (let i = 0; i < 120; i++) {
    const mid = 0.5 * (lo + hi);
    const fmid = f(mid);
    if (Math.abs(fmid) < 1e-10) return mid;

    if (flo * fmid <= 0) {
      hi = mid;
      fhi = fmid;
    } else {
      lo = mid;
      flo = fmid;
    }

    if (Math.abs(hi - lo) < 1e-8) return 0.5 * (lo + hi);
  }

  return 0.5 * (lo + hi);
}

