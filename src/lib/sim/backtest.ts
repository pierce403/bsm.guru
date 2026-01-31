import { normCdf } from "@/lib/quant/normal";
import { computePerpContrarianSignal, type PerpSide } from "@/lib/strategy/perp-signal";

export type CandlePoint = {
  time: number; // ms
  price: number; // mid/close
};

export type FundingPoint = {
  time: number; // ms
  fundingRate: number; // decimal rate; >0 means longs pay shorts
  premium: number; // decimal premium
};

export type BacktestStrategy =
  | { kind: "contrarian" }
  | { kind: "momentum" };

export type BacktestConfig = {
  intervalMs: number;
  startingCash: number;
  tradeNotional: number;
  slippageBps?: number;
  useFunding?: boolean;
  // Rolling realized vol window measured in *returns* (not prices). e.g. 48 for a 2-day window on 1h candles.
  volWindowReturns?: number;
  // How many candle steps to measure the sigma move over (e.g. 24 for 24h on 1h candles).
  zLookbackSteps?: number;
  enterAbsZ: number;
  exitAbsZ: number;
  maxHoldSteps?: number;
  // Optional: require signal "crowding" multiplier >= this value to enter.
  minCrowding?: number;
  strategy?: BacktestStrategy;
};

export type BacktestTrade = {
  side: PerpSide;
  entryTime: number;
  exitTime: number;
  entryPx: number;
  exitPx: number;
  qty: number;
  notional: number;
  pnlPx: number;
  fundingPnl: number;
  totalPnl: number;
  holdSteps: number;
  entryZ: number | null;
  exitZ: number | null;
  exitReason: "signal" | "timeout" | "end";
};

export type EquityPoint = {
  time: number;
  price: number;
  cash: number;
  equity: number;
  sigma: number | null;
  z: number | null;
  tailP: number | null;
  fundingRate: number | null;
  premium: number | null;
  positionSide: PerpSide | null;
  positionValue: number | null;
};

export type BacktestSummary = {
  startingCash: number;
  endingEquity: number;
  totalReturn: number;
  tradeCount: number;
  winRate: number | null;
  avgPnl: number | null;
  profitFactor: number | null;
  maxDrawdown: number;
  maxDrawdownPct: number | null;
};

export type BacktestResult = {
  config: BacktestConfig;
  summary: BacktestSummary;
  equity: EquityPoint[];
  trades: BacktestTrade[];
};

function applySlippage(price: number, side: PerpSide, slipBps: number, leg: "entry" | "exit") {
  const slip = Math.max(0, slipBps) / 10_000;
  if (slip === 0) return price;
  if (side === "long") return leg === "entry" ? price * (1 + slip) : price * (1 - slip);
  return leg === "entry" ? price * (1 - slip) : price * (1 + slip);
}

function rollingAnnualizedVolFromCloses(opts: {
  closes: number[];
  periodSeconds: number;
  windowReturns: number;
  yearSeconds?: number;
}): Array<number | null> {
  const { closes, periodSeconds, windowReturns, yearSeconds = 365 * 24 * 60 * 60 } = opts;
  const n = closes.length;
  const out: Array<number | null> = new Array(n).fill(null);
  if (n < 2) return out;
  if (!Number.isFinite(periodSeconds) || periodSeconds <= 0) return out;
  if (!Number.isFinite(windowReturns) || windowReturns < 2) return out;

  const rets: number[] = new Array(n).fill(0);
  const pref1: number[] = new Array(n).fill(0);
  const pref2: number[] = new Array(n).fill(0);

  for (let i = 1; i < n; i++) {
    const p0 = closes[i - 1]!;
    const p1 = closes[i]!;
    if (!Number.isFinite(p0) || !Number.isFinite(p1) || p0 <= 0 || p1 <= 0) {
      rets[i] = 0;
    } else {
      rets[i] = Math.log(p1 / p0);
    }
    pref1[i] = pref1[i - 1]! + rets[i]!;
    pref2[i] = pref2[i - 1]! + rets[i]! * rets[i]!;
  }

  const annualFactor = Math.sqrt(yearSeconds / periodSeconds);

  // Window is over returns, so for price index i we use returns (i-windowReturns+1 .. i).
  for (let i = windowReturns; i < n; i++) {
    const start = i - windowReturns + 1;
    const end = i;
    const k = windowReturns;
    const sum = pref1[end]! - pref1[start - 1]!;
    const sumSq = pref2[end]! - pref2[start - 1]!;
    const mean = sum / k;
    const variance = (sumSq - k * mean * mean) / (k - 1);
    const perPeriod = variance > 0 ? Math.sqrt(variance) : 0;
    out[i] = perPeriod * annualFactor;
  }

  return out;
}

function maxDrawdown(points: Array<{ equity: number }>) {
  let peak = -Infinity;
  let maxDd = 0;
  let maxDdPct: number | null = null;

  for (const p of points) {
    if (!Number.isFinite(p.equity)) continue;
    if (p.equity > peak) peak = p.equity;
    const dd = peak - p.equity;
    if (dd > maxDd) {
      maxDd = dd;
      maxDdPct = peak > 0 ? dd / peak : null;
    }
  }

  return { maxDd, maxDdPct };
}

export function runBacktest(opts: {
  candles: CandlePoint[];
  funding?: FundingPoint[];
  config: BacktestConfig;
}): BacktestResult {
  const cfg = opts.config;
  const intervalMs = cfg.intervalMs;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new Error("intervalMs must be > 0");
  if (!Number.isFinite(cfg.startingCash) || cfg.startingCash <= 0) throw new Error("startingCash must be > 0");
  if (!Number.isFinite(cfg.tradeNotional) || cfg.tradeNotional <= 0) throw new Error("tradeNotional must be > 0");
  if (!Number.isFinite(cfg.enterAbsZ) || cfg.enterAbsZ <= 0) throw new Error("enterAbsZ must be > 0");
  if (!Number.isFinite(cfg.exitAbsZ) || cfg.exitAbsZ < 0) throw new Error("exitAbsZ must be >= 0");

  const candles = [...opts.candles].sort((a, b) => a.time - b.time);
  const closes = candles.map((c) => c.price);
  const times = candles.map((c) => c.time);
  if (candles.length < 3) {
    return {
      config: cfg,
      summary: {
        startingCash: cfg.startingCash,
        endingEquity: cfg.startingCash,
        totalReturn: 0,
        tradeCount: 0,
        winRate: null,
        avgPnl: null,
        profitFactor: null,
        maxDrawdown: 0,
        maxDrawdownPct: null,
      },
      equity: [],
      trades: [],
    };
  }

  const volWindowReturns = cfg.volWindowReturns ?? 48;
  const zLookbackSteps = cfg.zLookbackSteps ?? 24;
  const maxHoldSteps = cfg.maxHoldSteps ?? 24 * 7;
  const slipBps = cfg.slippageBps ?? 0;
  const useFunding = cfg.useFunding ?? true;
  const strategy = cfg.strategy ?? { kind: "contrarian" };

  const periodSeconds = intervalMs / 1000;
  const sigmaArr = rollingAnnualizedVolFromCloses({ closes, periodSeconds, windowReturns: volWindowReturns });

  const funding = (opts.funding ?? []).slice().sort((a, b) => a.time - b.time);
  let fundingIdx = 0;
  let curFunding: FundingPoint | null = funding.length ? funding[0]! : null;

  type Pos = {
    side: PerpSide;
    notional: number;
    qty: number;
    entryPx: number;
    entryTime: number;
    entryIdx: number;
    entryZ: number | null;
    fundingPnl: number;
  };

  let cash = cfg.startingCash;
  let pos: Pos | null = null;

  const equity: EquityPoint[] = [];
  const trades: BacktestTrade[] = [];

  const yearMs = 365 * 24 * 60 * 60 * 1000;
  const hourMs = 60 * 60 * 1000;
  const stepHours = intervalMs / hourMs;

  for (let i = 0; i < candles.length; i++) {
    const time = times[i]!;
    const price = closes[i]!;

    while (fundingIdx + 1 < funding.length && funding[fundingIdx + 1]!.time <= time) {
      fundingIdx += 1;
      curFunding = funding[fundingIdx]!;
    }

    const fundingRate =
      curFunding && Number.isFinite(curFunding.fundingRate) ? curFunding.fundingRate : null;
    const premium =
      curFunding && Number.isFinite(curFunding.premium) ? curFunding.premium : null;

    const sigma = sigmaArr[i] ?? null;
    const canComputeZ =
      sigma !== null &&
      Number.isFinite(sigma) &&
      sigma > 0 &&
      i - zLookbackSteps >= 0 &&
      Number.isFinite(closes[i - zLookbackSteps]!) &&
      closes[i - zLookbackSteps]! > 0;

    const z = canComputeZ
      ? Math.log(price / closes[i - zLookbackSteps]!) / (sigma! * Math.sqrt((intervalMs * zLookbackSteps) / yearMs))
      : null;
    const tailP = z === null ? null : 2 * (1 - normCdf(Math.abs(z)));

    // Update funding accrual before we evaluate exit/entry.
    if (pos && useFunding && fundingRate !== null && Number.isFinite(fundingRate) && stepHours > 0) {
      const dir = pos.side === "short" ? 1 : -1;
      const notionalNow = pos.qty * price;
      pos.fundingPnl += dir * notionalNow * fundingRate * stepHours;
    }

    // Exit logic
    if (pos && z !== null) {
      const held = i - pos.entryIdx;
      const absZ = Math.abs(z);
      const shouldExitSignal = absZ <= cfg.exitAbsZ;
      const shouldExitTimeout = held >= maxHoldSteps;
      if (shouldExitSignal || shouldExitTimeout || i === candles.length - 1) {
        const exitPx = applySlippage(price, pos.side, slipBps, "exit");
        const dir = pos.side === "long" ? 1 : -1;
        const pnlPx = (exitPx - pos.entryPx) * pos.qty * dir;
        const totalPnl = pnlPx + pos.fundingPnl;

        cash += pos.notional + totalPnl;

        trades.push({
          side: pos.side,
          entryTime: pos.entryTime,
          exitTime: time,
          entryPx: pos.entryPx,
          exitPx,
          qty: pos.qty,
          notional: pos.notional,
          pnlPx,
          fundingPnl: pos.fundingPnl,
          totalPnl,
          holdSteps: held,
          entryZ: pos.entryZ,
          exitZ: z,
          exitReason: i === candles.length - 1 ? "end" : shouldExitTimeout ? "timeout" : "signal",
        });

        pos = null;
      }
    }

    // Entry logic (after exits)
    if (!pos && z !== null && Number.isFinite(z)) {
      const absZ = Math.abs(z);
      if (absZ >= cfg.enterAbsZ && cash >= cfg.tradeNotional) {
        const signal = computePerpContrarianSignal({
          sigmaMove24h: z,
          fundingRate,
          premium,
        });
        if (signal) {
          const minCrowding = cfg.minCrowding ?? null;
          if (minCrowding !== null && signal.crowding < minCrowding) {
            // skip
          } else {
            const baseSide = signal.side;
            const side: PerpSide =
              strategy.kind === "contrarian" ? baseSide : baseSide === "short" ? "long" : "short";

            const entryPx = applySlippage(price, side, slipBps, "entry");
            const qty = cfg.tradeNotional / entryPx;
            pos = {
              side,
              notional: cfg.tradeNotional,
              qty,
              entryPx,
              entryTime: time,
              entryIdx: i,
              entryZ: z,
              fundingPnl: 0,
            };
            cash -= cfg.tradeNotional;
          }
        }
      }
    }

    const positionValue = pos
      ? (() => {
          const dir = pos.side === "long" ? 1 : -1;
          const pnlPxUnreal = (price - pos.entryPx) * pos.qty * dir;
          return pos.notional + pnlPxUnreal + pos.fundingPnl;
        })()
      : null;
    const equityNow = cash + (positionValue ?? 0);

    equity.push({
      time,
      price,
      cash,
      equity: equityNow,
      sigma,
      z,
      tailP,
      fundingRate,
      premium,
      positionSide: pos?.side ?? null,
      positionValue,
    });
  }

  const endingEquity = equity.length ? equity[equity.length - 1]!.equity : cash;
  const totalReturn = endingEquity / cfg.startingCash - 1;

  const tradeCount = trades.length;
  const wins = trades.filter((t) => t.totalPnl > 0);
  const losses = trades.filter((t) => t.totalPnl < 0);
  const winRate = tradeCount ? wins.length / tradeCount : null;
  const avgPnl = tradeCount ? trades.reduce((s, t) => s + t.totalPnl, 0) / tradeCount : null;
  const winSum = wins.reduce((s, t) => s + t.totalPnl, 0);
  const lossSum = losses.reduce((s, t) => s + t.totalPnl, 0);
  const profitFactor = lossSum < 0 ? winSum / Math.abs(lossSum) : null;

  const dd = maxDrawdown(equity);

  return {
    config: cfg,
    summary: {
      startingCash: cfg.startingCash,
      endingEquity,
      totalReturn,
      tradeCount,
      winRate,
      avgPnl,
      profitFactor,
      maxDrawdown: dd.maxDd,
      maxDrawdownPct: dd.maxDdPct,
    },
    equity,
    trades,
  };
}
