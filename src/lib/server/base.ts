import "server-only";

import { Interface, JsonRpcProvider, Wallet, formatEther, isAddress } from "ethers";

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
  l1FeeWei: string;
  txHash: string;
};

function mulDiv(n: bigint, mul: bigint, div: bigint) {
  return (n * mul) / div;
}

const GAS_PRICE_ORACLE = "0x420000000000000000000000000000000000000F";
const gasOracleIface = new Interface([
  "function getL1Fee(bytes) view returns (uint256)",
]);

async function estimateBaseL1FeeWei(provider: JsonRpcProvider, rawTx: string) {
  try {
    const data = gasOracleIface.encodeFunctionData("getL1Fee", [rawTx]);
    const res = await provider.call({ to: GAS_PRICE_ORACLE, data });
    const decoded = gasOracleIface.decodeFunctionResult("getL1Fee", res) as unknown as [
      bigint,
    ];
    return decoded[0] ?? BigInt(0);
  } catch {
    return BigInt(0);
  }
}

export async function withdrawAllBaseEth(opts: {
  fromAddress: string;
  toAddress: string;
  password?: string;
}): Promise<BaseWithdrawAllResult> {
  const from = opts.fromAddress.toLowerCase();
  const to = opts.toAddress.toLowerCase();

  if (!isAddress(from)) throw new Error("Invalid from address");
  if (!isAddress(to)) throw new Error("Invalid to address");
  if (from === to) throw new Error("From and to cannot be the same address");

  const provider = getBaseProvider();

  const keystoreJson = readKeystore(from);
  const wallet = await Wallet.fromEncryptedJson(keystoreJson, opts.password ?? "");
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
  const eip1559MaxFee = feeData.maxFeePerGas;
  const eip1559Tip = feeData.maxPriorityFeePerGas;
  const legacyGasPrice = feeData.gasPrice;

  const feePerGasBudget = eip1559MaxFee ?? legacyGasPrice ?? null;
  if (!feePerGasBudget) throw new Error("Unable to determine gas price");

  const nonce = await provider.getTransactionCount(from, "pending");
  const baseTx: Parameters<typeof signer.sendTransaction>[0] = {
    to,
    gasLimit,
    nonce,
    chainId: BASE_CHAIN_ID,
  };

  if (eip1559MaxFee && eip1559Tip) {
    baseTx.maxFeePerGas = eip1559MaxFee;
    baseTx.maxPriorityFeePerGas = eip1559Tip;
    baseTx.type = 2;
  } else {
    baseTx.gasPrice = feePerGasBudget;
  }

  const l2GasCost = gasLimit * feePerGasBudget;

  // OP-stack chains (including Base) can charge additional L1 data fees. Estimate that
  // from the GasPriceOracle predeploy and keep a buffer to avoid insufficient-funds
  // errors if fees shift between estimation and submission.
  let l1FeeBudget = BigInt(0);
  let value = balance - l2GasCost;
  for (let i = 0; i < 3; i += 1) {
    if (value <= BigInt(0)) break;
    const raw = await signer.signTransaction({ ...baseTx, value });
    const l1 = await estimateBaseL1FeeWei(provider, raw);
    const buffered =
      l1 > BigInt(0)
        ? l1 + mulDiv(l1, BigInt(2), BigInt(10)) + BigInt(1_000_000_000) // +20% + 1 gwei
        : (() => {
            const tenPercent = mulDiv(l2GasCost, BigInt(1), BigInt(10));
            return tenPercent > BigInt(10_000_000_000)
              ? tenPercent
              : BigInt(10_000_000_000); // 10 gwei fallback
          })();
    const next = balance - l2GasCost - buffered;
    l1FeeBudget = buffered;
    if (next === value) break;
    value = next;
  }

  if (value <= BigInt(0)) {
    throw new Error(
      `Balance too small to cover gas (balance ${formatEther(balance)} ETH)`,
    );
  }

  const tx = await signer.sendTransaction({ ...baseTx, value });

  return {
    chainId: BASE_CHAIN_ID,
    from,
    to,
    valueWei: value.toString(),
    valueEth: formatEther(value),
    gasLimit: gasLimit.toString(),
    feePerGasWei: feePerGasBudget.toString(),
    l1FeeWei: l1FeeBudget.toString(),
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
