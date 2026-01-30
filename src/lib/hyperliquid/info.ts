export const HYPERLIQUID_API_URL =
  process.env.HYPERLIQUID_API_URL ?? "https://api.hyperliquid.xyz";

export async function hyperliquidInfo<TResponse>(
  payload: unknown,
  init?: { signal?: AbortSignal },
): Promise<TResponse> {
  const res = await fetch(`${HYPERLIQUID_API_URL}/info`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
    signal: init?.signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Hyperliquid /info failed: ${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`,
    );
  }

  return (await res.json()) as TResponse;
}

export type HyperliquidAllMids = Record<string, string>;

export async function getAllMids() {
  return hyperliquidInfo<HyperliquidAllMids>({ type: "allMids" });
}

export type HyperliquidMetaUniverseAsset = {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  marginTableId: number;
  isDelisted?: boolean;
};

export type HyperliquidMeta = { universe: HyperliquidMetaUniverseAsset[] };

export async function getMeta() {
  return hyperliquidInfo<HyperliquidMeta>({ type: "meta" });
}

export type HyperliquidCandle = {
  t: number; // start time ms
  T: number; // end time ms
  s: string; // symbol
  i: string; // interval
  o: string; // open
  c: string; // close
  h: string; // high
  l: string; // low
  v: string; // volume
  n: number; // trade count
};

export async function getCandleSnapshot(req: {
  coin: string;
  interval: string;
  startTime: number;
  endTime: number;
}) {
  return hyperliquidInfo<HyperliquidCandle[]>({
    type: "candleSnapshot",
    req,
  });
}
