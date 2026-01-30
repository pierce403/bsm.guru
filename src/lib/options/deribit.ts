export const DERIBIT_API_URL =
  process.env.DERIBIT_API_URL ?? "https://www.deribit.com/api/v2";

type DeribitRpcError = { message?: string };
type DeribitRpcResponse<TResult> = {
  jsonrpc: string;
  result?: TResult;
  error?: DeribitRpcError;
};

export type DeribitOptionInstrument = {
  instrument_name: string;
  kind: "option";
  expiration_timestamp: number;
  strike: number;
  option_type: "call" | "put";
};

export type DeribitTicker = {
  instrument_name: string;
  underlying_price: number; // USD
  mark_price: number; // in underlying units (e.g. BTC for BTC options)
  best_bid_price: number | null;
  best_ask_price: number | null;
  mark_iv?: number; // percent (e.g. 89.05)
  bid_iv?: number; // percent
  ask_iv?: number; // percent
};

export type OptionQuoteUsd = {
  instrumentName: string;
  underlyingUsd: number;
  bidUsd: number | null;
  askUsd: number | null;
  midUsd: number | null;
  markUsd: number | null;
  ivMark: number | null; // decimal (e.g. 0.8905)
};

export type AtmOptionSnapshot = {
  venue: "deribit";
  symbol: string;
  spotUsd: number;
  expiryTs: number;
  strike: number;
  call: OptionQuoteUsd | null;
  put: OptionQuoteUsd | null;
};

function toNumber(v: unknown) {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function toUsd(pUnderlying: number | null, underlyingUsd: number | null) {
  if (
    typeof pUnderlying !== "number" ||
    !Number.isFinite(pUnderlying) ||
    typeof underlyingUsd !== "number" ||
    !Number.isFinite(underlyingUsd)
  )
    return null;
  return pUnderlying * underlyingUsd;
}

export function midFromBidAsk(args: {
  bid: number | null;
  ask: number | null;
  mark: number | null;
}) {
  const bid = toNumber(args.bid);
  const ask = toNumber(args.ask);
  const mark = toNumber(args.mark);

  if (bid !== null && ask !== null && bid > 0 && ask > 0) return 0.5 * (bid + ask);
  if (mark !== null && mark > 0) return mark;
  if (bid !== null && bid > 0) return bid;
  if (ask !== null && ask > 0) return ask;
  return null;
}

async function deribitGet<TResult>(
  path: string,
  params: Record<string, string | number | boolean>,
) {
  const url = new URL(`${DERIBIT_API_URL}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Deribit ${path} failed: ${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`,
    );
  }

  const json = (await res.json()) as DeribitRpcResponse<TResult>;
  if (json.error) throw new Error(json.error.message ?? "Deribit error");
  if (json.result === undefined) throw new Error("Deribit response missing result");
  return json.result;
}

async function getInstruments(currency: string) {
  return deribitGet<DeribitOptionInstrument[]>("/public/get_instruments", {
    currency,
    kind: "option",
    expired: false,
  });
}

async function getTicker(instrumentName: string) {
  return deribitGet<DeribitTicker>("/public/ticker", {
    instrument_name: instrumentName,
  });
}

function quoteFromTicker(t: DeribitTicker): OptionQuoteUsd | null {
  const underlyingUsd = toNumber(t.underlying_price);
  if (underlyingUsd === null || underlyingUsd <= 0) return null;

  const bid = toUsd(toNumber(t.best_bid_price), underlyingUsd);
  const ask = toUsd(toNumber(t.best_ask_price), underlyingUsd);
  const mark = toUsd(toNumber(t.mark_price), underlyingUsd);
  const mid = midFromBidAsk({
    bid,
    ask,
    mark,
  });

  const ivMarkPct = toNumber(t.mark_iv ?? null);
  const ivMark = ivMarkPct === null ? null : ivMarkPct / 100;

  return {
    instrumentName: t.instrument_name,
    underlyingUsd,
    bidUsd: bid,
    askUsd: ask,
    midUsd: mid,
    markUsd: mark,
    ivMark,
  };
}

export function pickClosestExpiryTs(opts: {
  expiryTimestamps: number[];
  targetTs: number;
  minTs: number;
}) {
  const valid = opts.expiryTimestamps.filter((x) => Number.isFinite(x) && x > opts.minTs);
  if (valid.length === 0) return null;
  valid.sort((a, b) => Math.abs(a - opts.targetTs) - Math.abs(b - opts.targetTs));
  return valid[0]!;
}

export function pickNearestStrike(strikes: number[], spotUsd: number) {
  const valid = strikes.filter((x) => Number.isFinite(x) && x > 0);
  if (valid.length === 0) return null;
  valid.sort((a, b) => Math.abs(a - spotUsd) - Math.abs(b - spotUsd));
  return valid[0]!;
}

export async function fetchDeribitAtmOptionSnapshot(opts: {
  symbol: string;
  spotUsd: number;
  targetDays?: number;
  minHours?: number;
}): Promise<AtmOptionSnapshot | null> {
  const { symbol } = opts;
  const spotUsd = toNumber(opts.spotUsd);
  if (!spotUsd || spotUsd <= 0) return null;

  // Deribit options coverage is limited; keep a strict allowlist to avoid
  // confusing "no markets" with a network issue.
  const allow = new Set(["BTC", "ETH", "SOL"]);
  if (!allow.has(symbol)) return null;

  const targetDays = toNumber(opts.targetDays ?? 7) ?? 7;
  const minHours = toNumber(opts.minHours ?? 6) ?? 6;

  const now = Date.now();
  const targetTs = now + targetDays * 24 * 60 * 60 * 1000;
  const minTs = now + minHours * 60 * 60 * 1000;

  const instruments = await getInstruments(symbol);
  const expiries = Array.from(
    new Set(instruments.map((i) => i.expiration_timestamp)),
  );
  const expiryTs = pickClosestExpiryTs({ expiryTimestamps: expiries, targetTs, minTs });
  if (!expiryTs) return null;

  const sameExp = instruments.filter((i) => i.expiration_timestamp === expiryTs);
  const strike = pickNearestStrike(
    Array.from(new Set(sameExp.map((i) => i.strike))),
    spotUsd,
  );
  if (!strike) return null;

  const callInst = sameExp.find((i) => i.option_type === "call" && i.strike === strike);
  const putInst = sameExp.find((i) => i.option_type === "put" && i.strike === strike);

  const [callTicker, putTicker] = await Promise.all([
    callInst ? getTicker(callInst.instrument_name).catch(() => null) : Promise.resolve(null),
    putInst ? getTicker(putInst.instrument_name).catch(() => null) : Promise.resolve(null),
  ]);

  const call = callTicker ? quoteFromTicker(callTicker) : null;
  const put = putTicker ? quoteFromTicker(putTicker) : null;

  return {
    venue: "deribit",
    symbol,
    spotUsd,
    expiryTs,
    strike,
    call,
    put,
  };
}
