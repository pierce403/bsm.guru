import "server-only";

import { JsonRpcProvider, Wallet, formatEther, isAddress } from "ethers";

import { readKeystore } from "@/lib/server/wallets";

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

export type BaseWithdrawAllResult = {
  chainId: number;
  from: string;
  to: string;
  valueWei: string;
  valueEth: string;
  gasLimit: string;
  feePerGasWei: string;
  txHash: string;
};

function mulDiv(n: bigint, mul: bigint, div: bigint) {
  return (n * mul) / div;
}

export async function withdrawAllBaseEth(opts: {
  fromAddress: string;
  toAddress: string;
  password: string;
}): Promise<BaseWithdrawAllResult> {
  const from = opts.fromAddress.toLowerCase();
  const to = opts.toAddress.toLowerCase();

  if (!isAddress(from)) throw new Error("Invalid from address");
  if (!isAddress(to)) throw new Error("Invalid to address");
  if (from === to) throw new Error("From and to cannot be the same address");

  const provider = getBaseProvider();

  const keystoreJson = readKeystore(from);
  const wallet = await Wallet.fromEncryptedJson(keystoreJson, opts.password);
  if (wallet.address.toLowerCase() !== from) {
    throw new Error("Keystore does not match the requested from address");
  }
  const signer = wallet.connect(provider);

  const balance = await provider.getBalance(from);
  if (balance <= BigInt(0)) throw new Error("No ETH balance to withdraw");

  // Estimate gas + fee data, then send max value that still leaves room for fees.
  const estimate = await provider
    .estimateGas({ from, to, value: BigInt(0) })
    .catch(() => BigInt(21_000));
  const gasLimit = mulDiv(estimate, BigInt(12), BigInt(10)); // +20% buffer

  const feeData = await provider.getFeeData();
  const feePerGas =
    feeData.maxFeePerGas ?? feeData.gasPrice ?? null;
  if (!feePerGas) throw new Error("Unable to determine gas price");

  const gasCost = gasLimit * feePerGas;
  const value = balance - gasCost;
  if (value <= BigInt(0)) {
    throw new Error(
      `Balance too small to cover gas (balance ${formatEther(balance)} ETH)`,
    );
  }

  const txRequest: Parameters<typeof signer.sendTransaction>[0] = {
    to,
    value,
    gasLimit,
  };

  if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
    txRequest.maxFeePerGas = feeData.maxFeePerGas;
    txRequest.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
  } else {
    txRequest.gasPrice = feePerGas;
  }

  const tx = await signer.sendTransaction(txRequest);

  return {
    chainId: BASE_CHAIN_ID,
    from,
    to,
    valueWei: value.toString(),
    valueEth: formatEther(value),
    gasLimit: gasLimit.toString(),
    feePerGasWei: feePerGas.toString(),
    txHash: tx.hash,
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
