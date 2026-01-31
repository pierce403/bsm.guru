export type PerpSide = "long" | "short";

export type PerpSignalInputs = {
  sigmaMove24h: number | null;
  dayNtlVlm?: number | null;
  // Hyperliquid context values (typically small decimals).
  // fundingRate > 0 => longs pay shorts.
  fundingRate?: number | null;
  // premium > 0 => perp trading above index/oracle (venue-specific definition).
  premium?: number | null;
};

export type PerpSignalWeights = {
  // Scales how much we bias toward liquid markets. (We default to legacy behavior: 1 + log10(volume).)
  liquidityWeight?: number;
  // Multiplier weights for how much funding/premium should affect the score.
  fundingWeight?: number;
  premiumWeight?: number;
  // Convert funding/premium into a normalized [-1, 1] “alignment” score via bps/scale.
  fundingScaleBps?: number;
  premiumScaleBps?: number;
  // Clamp applied to the funding/premium "crowding" multiplier.
  crowdingMin?: number;
  crowdingMax?: number;
};

export type PerpSignal = {
  side: PerpSide; // contrarian side suggested by the sigma move sign
  score: number; // higher = stronger contrarian opportunity (after liquidity + crowding)
  z: number;
  absZ: number;
  liqLog10: number;
  liquidityFactor: number;
  fundingRate: number | null;
  premium: number | null;
  fundingBps: number | null;
  premiumBps: number | null;
  fundingAlignBps: number | null;
  premiumAlignBps: number | null;
  fundingQuality: number; // [-1, 1]
  premiumQuality: number; // [-1, 1]
  crowding: number; // multiplier applied to the base score
};

export type PerpHealthAction = "hold" | "review" | "exit" | "exit_now";
export type PerpHealth = {
  score: number | null; // [-1, +1], positive means aligned
  label: string | null;
  action: PerpHealthAction | null;
};

function clamp(n: number, lo: number, hi: number) {
  return Math.min(Math.max(n, lo), hi);
}

function toBps(n: number | null) {
  if (n === null || !Number.isFinite(n)) return null;
  return n * 10_000;
}

export function contrarianSideFromSigmaMove(z: number): PerpSide {
  return z >= 0 ? "short" : "long";
}

export function computePerpContrarianSignal(
  inputs: PerpSignalInputs,
  weights?: PerpSignalWeights,
): PerpSignal | null {
  const zRaw = inputs.sigmaMove24h;
  if (zRaw === null || !Number.isFinite(zRaw)) return null;

  const z = zRaw;
  const absZ = Math.abs(z);
  const side = contrarianSideFromSigmaMove(z);

  const liq = Number(inputs.dayNtlVlm ?? 0);
  const liqLog10 = Number.isFinite(liq) && liq > 0 ? Math.log10(liq + 1) : 0;
  const liquidityWeight = weights?.liquidityWeight ?? 1;
  const liquidityFactor = 1 + liquidityWeight * liqLog10;

  const fundingRate =
    inputs.fundingRate === undefined ? null : (Number.isFinite(inputs.fundingRate ?? NaN) ? (inputs.fundingRate ?? null) : null);
  const premium =
    inputs.premium === undefined ? null : (Number.isFinite(inputs.premium ?? NaN) ? (inputs.premium ?? null) : null);

  const fundingBps = toBps(fundingRate);
  const premiumBps = toBps(premium);

  const alignSign = side === "short" ? 1 : -1;
  const fundingAlignBps = fundingBps === null ? null : fundingBps * alignSign;
  const premiumAlignBps = premiumBps === null ? null : premiumBps * alignSign;

  const fundingScaleBps = weights?.fundingScaleBps ?? 10;
  const premiumScaleBps = weights?.premiumScaleBps ?? 25;

  const fundingQuality =
    fundingAlignBps === null ? 0 : clamp(fundingAlignBps / fundingScaleBps, -1, 1);
  const premiumQuality =
    premiumAlignBps === null ? 0 : clamp(premiumAlignBps / premiumScaleBps, -1, 1);

  const fundingWeight = weights?.fundingWeight ?? 0.35;
  const premiumWeight = weights?.premiumWeight ?? 0.25;

  const crowdingRaw = 1 + fundingWeight * fundingQuality + premiumWeight * premiumQuality;
  const crowdingMin = weights?.crowdingMin ?? 0.25;
  const crowdingMax = weights?.crowdingMax ?? 2.0;
  const crowding = clamp(crowdingRaw, crowdingMin, crowdingMax);

  const base = absZ * liquidityFactor;
  const score = base * crowding;

  return {
    side,
    score,
    z,
    absZ,
    liqLog10,
    liquidityFactor,
    fundingRate,
    premium,
    fundingBps,
    premiumBps,
    fundingAlignBps,
    premiumAlignBps,
    fundingQuality,
    premiumQuality,
    crowding,
  };
}

export function healthForPositionFromSignal(opts: {
  positionSide: PerpSide;
  signal: PerpSignal | null;
}): PerpHealth {
  const sig = opts.signal;
  if (!sig) return { score: null, label: null, action: null };

  const aligned = sig.side === opts.positionSide;
  const strength = clamp(sig.absZ / 2.5, 0, 1);
  const carryQuality = clamp(0.6 * sig.fundingQuality + 0.4 * sig.premiumQuality, -1, 1);

  // Combined score can go down even when a position is in profit: it measures whether
  // the *original contrarian signal + crowding* still looks present.
  const combined = clamp(0.75 * strength + 0.25 * carryQuality, -1, 1);
  const signed = aligned ? combined : -combined;

  if (!aligned) {
    return sig.absZ >= 1
      ? { score: signed, label: "Exit now", action: "exit_now" }
      : { score: signed, label: "Exit", action: "exit" };
  }

  if (combined < 0.12) return { score: signed, label: "Edge gone", action: "exit" };
  if (combined < 0.35) return { score: signed, label: "Weak", action: "review" };
  if (combined < 0.7) return { score: signed, label: "Good", action: "hold" };
  return { score: signed, label: "Strong", action: "hold" };
}

