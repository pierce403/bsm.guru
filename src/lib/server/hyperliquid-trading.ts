import "server-only";

import { Wallet, isAddress } from "ethers";

import { hyperliquidInfo } from "@/lib/hyperliquid/info";
import { readKeystore } from "@/lib/server/wallets";

type PlaceOrderResponse = unknown;

type MetaAndCtxs = [
  { universe: Array<{ name: string; szDecimals: number }> },
  Array<{ midPx: string; impactPxs?: [string, string] }>,
];

type OrderResponseShape = {
  response?: { data?: { statuses?: unknown[] } };
  data?: { statuses?: unknown[] };
};

type FilledStatus = {
  filled?: {
    totalSz?: string | number;
    avgPx?: string | number;
    oid?: string | number;
  };
};

type OrderStatusAny = {
  filled?: { totalSz?: string | number; avgPx?: string | number; oid?: string | number };
  resting?: { oid?: string | number };
  // Observed in some failure cases (SDK/API evolves); keep broad but typed.
  error?: string;
  rejected?: string | { error?: string; reason?: string };
  canceled?: string | { reason?: string };
  marginCanceled?: string | { reason?: string };
  [k: string]: unknown;
};

export type HyperliquidTradeProof = {
  hypurrscanAddressUrl: string;
  dexlyAddressUrl: string;
};

export type HyperliquidFill = {
  oid: number | null;
  avgPx: number;
  totalSz: number;
};

export type HyperliquidPlacePerpResult = {
  response: PlaceOrderResponse;
  fill: HyperliquidFill;
  proof: HyperliquidTradeProof;
  // Execution context useful for debugging / reproducibility.
  exec: {
    slippageBps: number;
    midPx: number;
    limitPx: number;
    qty: number;
    attempt: number;
  };
};

function proofForAddress(address: string): HyperliquidTradeProof {
  const a = address.toLowerCase();
  // Both are SPAs; these URLs are still useful as a "neutral proof" view.
  return {
    hypurrscanAddressUrl: `https://hypurrscan.io/address/${a}`,
    dexlyAddressUrl: `https://dexly.trade/explorer?address=${a}`,
  };
}

function toNum(v: unknown) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function roundToDecimals(n: number, decimals: number) {
  const p = 10 ** Math.min(Math.max(decimals, 0), 18);
  return Math.floor(n * p) / p;
}

function extractFill(res: unknown): HyperliquidFill {
  const r = res as unknown as OrderResponseShape;
  const statuses: unknown =
    r.response?.data?.statuses ??
    r.data?.statuses ??
    null;
  if (!Array.isArray(statuses)) {
    throw new Error("Unexpected order response (no statuses)");
  }

  let restingOid: number | null = null;
  const rawStatuses = statuses as OrderStatusAny[];

  // Surface explicit rejection reasons if present.
  for (const st of rawStatuses) {
    if (typeof st?.error === "string" && st.error.trim()) {
      throw new Error(`Order rejected: ${st.error.trim()}`);
    }
    if (typeof st?.rejected === "string" && st.rejected.trim()) {
      throw new Error(`Order rejected: ${st.rejected.trim()}`);
    }
    if (st?.rejected && typeof st.rejected === "object") {
      const msg =
        typeof st.rejected.error === "string"
          ? st.rejected.error
          : typeof st.rejected.reason === "string"
            ? st.rejected.reason
            : "";
      if (msg.trim()) throw new Error(`Order rejected: ${msg.trim()}`);
    }
  }

  for (const st of statuses) {
    const filled = (st as FilledStatus)?.filled ?? null;
    if (!filled) continue;

    const totalSz = toNum(filled.totalSz);
    const avgPx = toNum(filled.avgPx);
    const oid = toNum(filled.oid);
    if (totalSz === null || avgPx === null) continue;

    return {
      oid: oid === null ? null : Math.floor(oid),
      avgPx,
      totalSz,
    };
  }

  for (const st of rawStatuses) {
    const resting = st?.resting ?? null;
    const oid = toNum(resting?.oid);
    if (oid !== null) {
      restingOid = Math.floor(oid);
      break;
    }
  }

  const compact = (() => {
    try {
      // Keep it short; enough to debug but not flood logs/UI.
      return JSON.stringify(rawStatuses.slice(0, 3));
    } catch {
      return "";
    }
  })();

  // If IOC doesn't fill, Hyperliquid may return a "resting" or other status.
  // Treat that as a failure for now since the UI expects immediate execution.
  throw new Error(
    `Order did not fill (no filled status${restingOid !== null ? `; resting oid ${restingOid}` : ""}${compact ? `; statuses ${compact}` : ""})`,
  );
}

function uniq<T>(arr: T[]) {
  const out: T[] = [];
  const seen = new Set<T>();
  for (const v of arr) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function slippageSchedule(baseBps: number) {
  const b = Math.min(Math.max(Math.floor(baseBps), 0), 2000);
  // Escalate quickly but cap the worst-case.
  return uniq([
    b,
    Math.min(Math.max(b * 3, 100), 2000),
    Math.min(Math.max(b * 8, 250), 2000),
    500,
    1000,
    2000,
  ]);
}

export async function placePerpIocOrder(opts: {
  walletAddress: string;
  // e.g. "BTC"
  symbol: string;
  side: "long" | "short";
  notionalUsd: number;
  password?: string;
  // Default 50 bps. Buy uses mid*(1+slip), sell uses mid*(1-slip).
  slippageBps?: number;
}): Promise<HyperliquidPlacePerpResult> {
  const walletAddress = opts.walletAddress.toLowerCase();
  if (!isAddress(walletAddress)) throw new Error("Invalid wallet address");

  const symbol = opts.symbol.toUpperCase();
  if (!/^[A-Z0-9]{2,10}$/.test(symbol)) throw new Error("Invalid symbol");

  const notionalUsd = toNum(opts.notionalUsd);
  if (notionalUsd === null || notionalUsd <= 0) throw new Error("Invalid notional");

  if ((process.env.BSM_TRADING_MODE ?? "").toLowerCase() === "mock") {
    const px = symbol === "BTC" ? 100_000 : symbol === "ETH" ? 3000 : 100;
    const totalSz = notionalUsd / px;
    return {
      response: { mock: true, symbol, side: opts.side, notionalUsd },
      fill: { oid: 1, avgPx: px, totalSz },
      proof: proofForAddress(walletAddress),
      exec: {
        slippageBps: 0,
        midPx: px,
        limitPx: px,
        qty: totalSz,
        attempt: 1,
      },
    };
  }

  const keystoreJson = readKeystore(walletAddress);
  const signer = await Wallet.fromEncryptedJson(keystoreJson, opts.password ?? "");
  if (signer.address.toLowerCase() !== walletAddress) {
    throw new Error("Keystore does not match the requested wallet address");
  }

  // Use the hyperliquid SDK for signing + /exchange submission.
  // WebSocket is disabled to avoid Node version issues and because we only need REST.
  const { Hyperliquid } = await import("hyperliquid");
  const sdk = new Hyperliquid({
    enableWs: false,
    privateKey: signer.privateKey,
    testnet: process.env.HYPERLIQUID_TESTNET === "true",
  });

  // IOC can fail to fill when the spread is wider than our slip.
  // Retry a few times with higher slippage before giving up.
  const slips = slippageSchedule(opts.slippageBps ?? 50);
  let lastNoFill: Error | null = null;
  const attempts: Array<{
    slippageBps: number;
    midPx: number;
    refPx: number;
    limitPx: number;
    qty: number;
  }> = [];

  for (let attempt = 0; attempt < slips.length; attempt++) {
    const slippageBps = slips[attempt]!;
    const slip = slippageBps / 10_000;

    // Pull szDecimals and a mid price from Hyperliquid directly for sizing.
    const [meta, assetCtxs] = await hyperliquidInfo<MetaAndCtxs>({
      type: "metaAndAssetCtxs",
    });
    const uni: Array<{ name: string; szDecimals: number }> = meta.universe ?? [];
    const idx = uni.findIndex((u) => u?.name === symbol);
    if (idx < 0) throw new Error(`Unknown Hyperliquid asset: ${symbol}`);

    const ctx = assetCtxs[idx] ?? null;
    const midPx = toNum(ctx?.midPx);
    if (midPx === null || midPx <= 0) throw new Error("No mid price for asset");

    const impactPxs = ctx?.impactPxs ?? null;
    const impactBid = impactPxs ? toNum(impactPxs[0]) : null;
    const impactAsk = impactPxs ? toNum(impactPxs[1]) : null;

    const szDecimals = toNum(uni[idx]?.szDecimals);
    if (szDecimals === null || szDecimals < 0) throw new Error("No szDecimals for asset");

    const qty = roundToDecimals(notionalUsd / midPx, szDecimals);
    if (!Number.isFinite(qty) || qty <= 0) throw new Error("Computed size is too small");

    const isBuy = opts.side === "long";
    // Prefer impact price (more "crossing") if available, otherwise use mid.
    const refPx =
      isBuy
        ? impactAsk !== null && impactAsk > 0
          ? impactAsk
          : midPx
        : impactBid !== null && impactBid > 0
          ? impactBid
          : midPx;
    const limitPx = isBuy ? refPx * (1 + slip) : refPx * (1 - slip);
    attempts.push({ slippageBps, midPx, refPx, limitPx, qty });

    try {
      const res = (await sdk.exchange.placeOrder({
        coin: `${symbol}-PERP`,
        is_buy: isBuy,
        sz: qty,
        limit_px: limitPx,
        order_type: { limit: { tif: "Ioc" } },
        reduce_only: false,
      })) as PlaceOrderResponse;

      const fill = extractFill(res);
      return {
        response: res,
        fill,
        proof: proofForAddress(walletAddress),
        exec: { slippageBps, midPx, limitPx, qty, attempt: attempt + 1 },
      };
    } catch (e) {
      const err = e instanceof Error ? e : new Error("Order failed");
      if (err.message.startsWith("Order did not fill")) {
        lastNoFill = err;
        continue;
      }
      throw err;
    }
  }

  const attemptMsg = attempts.length
    ? ` attempts: ${attempts
        .slice(0, 6)
        .map(
          (a) =>
            `${a.slippageBps}bps@${a.limitPx.toFixed(4)}(ref ${a.refPx.toFixed(4)}, mid ${a.midPx.toFixed(4)}, qty ${a.qty})`,
        )
        .join(" | ")}`
    : "";

  throw new Error(
    `${lastNoFill?.message ?? "Order did not fill"}${attemptMsg} (try increasing slippage or reducing size)`,
  );

}

export async function closePerpIocOrder(opts: {
  walletAddress: string;
  symbol: string;
  // size in base units
  qty: number;
  // Closing direction is opposite of entry side
  closeSide: "buy" | "sell";
  password?: string;
  slippageBps?: number;
}): Promise<HyperliquidPlacePerpResult> {
  const walletAddress = opts.walletAddress.toLowerCase();
  if (!isAddress(walletAddress)) throw new Error("Invalid wallet address");

  const symbol = opts.symbol.toUpperCase();
  if (!/^[A-Z0-9]{2,10}$/.test(symbol)) throw new Error("Invalid symbol");

  const qty = toNum(opts.qty);
  if (qty === null || qty <= 0) throw new Error("Invalid qty");

  if ((process.env.BSM_TRADING_MODE ?? "").toLowerCase() === "mock") {
    const px = symbol === "BTC" ? 100_000 : symbol === "ETH" ? 3000 : 100;
    return {
      response: { mock: true, symbol, closeSide: opts.closeSide, qty },
      fill: { oid: 2, avgPx: px, totalSz: qty },
      proof: proofForAddress(walletAddress),
      exec: { slippageBps: 0, midPx: px, limitPx: px, qty, attempt: 1 },
    };
  }

  const keystoreJson = readKeystore(walletAddress);
  const signer = await Wallet.fromEncryptedJson(keystoreJson, opts.password ?? "");
  if (signer.address.toLowerCase() !== walletAddress) {
    throw new Error("Keystore does not match the requested wallet address");
  }

  const { Hyperliquid } = await import("hyperliquid");
  const sdk = new Hyperliquid({
    enableWs: false,
    privateKey: signer.privateKey,
    testnet: process.env.HYPERLIQUID_TESTNET === "true",
  });

  const slips = slippageSchedule(opts.slippageBps ?? 50);
  let lastNoFill: Error | null = null;
  const attempts: Array<{
    slippageBps: number;
    midPx: number;
    refPx: number;
    limitPx: number;
    qty: number;
  }> = [];

  for (let attempt = 0; attempt < slips.length; attempt++) {
    const slippageBps = slips[attempt]!;
    const slip = slippageBps / 10_000;

    const [meta, assetCtxs] = await hyperliquidInfo<MetaAndCtxs>({
      type: "metaAndAssetCtxs",
    });
    const uni: Array<{ name: string; szDecimals: number }> = meta.universe ?? [];
    const idx = uni.findIndex((u) => u?.name === symbol);
    if (idx < 0) throw new Error(`Unknown Hyperliquid asset: ${symbol}`);

    const ctx = assetCtxs[idx] ?? null;
    const midPx = toNum(ctx?.midPx);
    if (midPx === null || midPx <= 0) throw new Error("No mid price for asset");

    const impactPxs = ctx?.impactPxs ?? null;
    const impactBid = impactPxs ? toNum(impactPxs[0]) : null;
    const impactAsk = impactPxs ? toNum(impactPxs[1]) : null;

    const szDecimals = toNum(uni[idx]?.szDecimals);
    if (szDecimals === null || szDecimals < 0) throw new Error("No szDecimals for asset");

    const roundedQty = roundToDecimals(qty, szDecimals);
    const isBuy = opts.closeSide === "buy";
    const refPx =
      isBuy
        ? impactAsk !== null && impactAsk > 0
          ? impactAsk
          : midPx
        : impactBid !== null && impactBid > 0
          ? impactBid
          : midPx;
    const limitPx = isBuy ? refPx * (1 + slip) : refPx * (1 - slip);
    attempts.push({ slippageBps, midPx, refPx, limitPx, qty: roundedQty });

    try {
      const res = (await sdk.exchange.placeOrder({
        coin: `${symbol}-PERP`,
        is_buy: isBuy,
        sz: roundedQty,
        limit_px: limitPx,
        order_type: { limit: { tif: "Ioc" } },
        reduce_only: true,
      })) as PlaceOrderResponse;

      const fill = extractFill(res);
      return {
        response: res,
        fill,
        proof: proofForAddress(walletAddress),
        exec: { slippageBps, midPx, limitPx, qty: roundedQty, attempt: attempt + 1 },
      };
    } catch (e) {
      const err = e instanceof Error ? e : new Error("Order failed");
      if (err.message.startsWith("Order did not fill")) {
        lastNoFill = err;
        continue;
      }
      throw err;
    }
  }

  const attemptMsg = attempts.length
    ? ` attempts: ${attempts
        .slice(0, 6)
        .map(
          (a) =>
            `${a.slippageBps}bps@${a.limitPx.toFixed(4)}(ref ${a.refPx.toFixed(4)}, mid ${a.midPx.toFixed(4)}, qty ${a.qty})`,
        )
        .join(" | ")}`
    : "";

  throw new Error(
    `${lastNoFill?.message ?? "Order did not fill"}${attemptMsg} (try increasing slippage)`,
  );
}
