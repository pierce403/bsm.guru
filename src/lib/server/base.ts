import "server-only";

import { JsonRpcProvider, formatEther } from "ethers";

const BASE_CHAIN_ID = 8453;

function env(name: string, fallback: string) {
  return process.env[name] ?? fallback;
}

declare global {
  var __bsmBaseProvider: JsonRpcProvider | undefined;
}

export function getBaseProvider() {
  if (globalThis.__bsmBaseProvider) return globalThis.__bsmBaseProvider;

  const url = env("BASE_RPC_URL", "https://mainnet.base.org");
  const provider = new JsonRpcProvider(url, BASE_CHAIN_ID);
  globalThis.__bsmBaseProvider = provider;
  return provider;
}

export async function getBaseBalance(address: string) {
  const provider = getBaseProvider();
  const wei = await provider.getBalance(address);
  return {
    chainId: BASE_CHAIN_ID,
    balanceWei: wei.toString(),
    balanceEth: formatEther(wei),
  };
}

type BlockscoutTx = {
  hash: string;
  timeStamp: string;
  from: string;
  to: string;
  value: string;
  isError: string;
  txreceipt_status: string;
};

type BlockscoutResponse =
  | { status: string; message: string; result: BlockscoutTx[] }
  | { status: string; message: string; result: string };

export async function getBaseTxs(address: string, limit: number) {
  const apiBase = env("BASE_EXPLORER_API_URL", "https://base.blockscout.com/api");

  const url = new URL(apiBase);
  url.searchParams.set("module", "account");
  url.searchParams.set("action", "txlist");
  url.searchParams.set("address", address);
  url.searchParams.set("page", "1");
  url.searchParams.set("offset", String(limit));
  url.searchParams.set("sort", "desc");

  const res = await fetch(url.toString(), {
    method: "GET",
    cache: "no-store",
    headers: { "content-type": "application/json" },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Explorer request failed: ${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`,
    );
  }

  const data = (await res.json()) as BlockscoutResponse;
  if (!("result" in data)) return [];

  if (typeof data.result === "string") return [];

  return data.result.map((tx) => ({
    hash: tx.hash,
    ts: Number(tx.timeStamp) * 1000,
    from: tx.from,
    to: tx.to,
    valueWei: tx.value,
    valueEth: formatEther(BigInt(tx.value)),
    ok: tx.txreceipt_status === "1" && tx.isError === "0",
  }));
}
