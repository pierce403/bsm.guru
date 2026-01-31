import "server-only";

import { Interface, JsonRpcProvider, Wallet, formatEther, isAddress, parseEther } from "ethers";

import { readKeystore } from "@/lib/server/wallets";

const ARB_CHAIN_ID = 42161;

// Common Arbitrum addresses (verify before changing; these are widely-used canonical deployments).
const WETH_ARB = "0x82af49447d8a07e3bd95bd0d56f35241523fbab1";
const USDC_ARB = "0xaf88d065e77c8cc2239327c5edb3a432268e5831"; // native USDC (6 decimals)
const USDC_E_ARB = "0xff970a61a04b1ca14834a43f5de4533ebddb5cc8"; // USDC.e (bridged) (6 decimals)

// Hyperliquid Bridge2 deposit contract on Arbitrum (USDC deposits).
// Deposits are credited to msg.sender's Hyperliquid account.
const HYPERLIQUID_BRIDGE2_ARB = "0x2df1c51e09aecf9cacb7bc98cb1742757f163df7";

function env(name: string, fallback: string) {
  return process.env[name] ?? fallback;
}

declare global {
  var __bsmArbProvider: JsonRpcProvider | undefined;
}

export function getArbitrumProvider() {
  if (globalThis.__bsmArbProvider) return globalThis.__bsmArbProvider;
  const url = env("ARBITRUM_RPC_URL", "https://arb1.arbitrum.io/rpc");
  const provider = new JsonRpcProvider(url, ARB_CHAIN_ID);
  globalThis.__bsmArbProvider = provider;
  return provider;
}

export async function getArbitrumBalances(address: string) {
  if (!isAddress(address)) throw new Error("Invalid address");
  const provider = getArbitrumProvider();

  // Some RPCs can effectively return a "pending" balance by default.
  // Make both explicit so the UI can explain discrepancies.
  const [ethWeiLatest, ethWeiPending] = await Promise.all([
    provider.getBalance(address, "latest"),
    provider.getBalance(address, "pending"),
  ]);

  const erc20 = new Interface([
    "function balanceOf(address) view returns (uint256)",
    "function decimals() view returns (uint8)",
  ]);

  const wethRes = await provider.call({
    to: WETH_ARB,
    data: erc20.encodeFunctionData("balanceOf", [address]),
  });
  const wethWei = (erc20.decodeFunctionResult("balanceOf", wethRes) as unknown as [bigint])[0];

  const [usdcRes, usdceRes] = await Promise.all([
    provider.call({
      to: USDC_ARB,
      data: erc20.encodeFunctionData("balanceOf", [address]),
    }),
    provider.call({
      to: USDC_E_ARB,
      data: erc20.encodeFunctionData("balanceOf", [address]),
    }),
  ]);
  const usdcWei = (erc20.decodeFunctionResult("balanceOf", usdcRes) as unknown as [bigint])[0];
  const usdceWei = (erc20.decodeFunctionResult("balanceOf", usdceRes) as unknown as [bigint])[0];

  return {
    chainId: ARB_CHAIN_ID,
    ethWei: ethWeiLatest.toString(),
    eth: formatEther(ethWeiLatest),
    ethWeiPending: ethWeiPending.toString(),
    ethPending: formatEther(ethWeiPending),
    wethWei: wethWei.toString(),
    weth: formatEther(wethWei),
    usdcUnits: usdcWei.toString(),
    usdceUnits: usdceWei.toString(),
    // USDC is 6 decimals; keep raw units for UI formatting.
  };
}

export type UsdcDepositResult = {
  chainId: number;
  from: string;
  token: "usdc" | "usdce";
  usdcUnits: string;
  depositTxHash: string;
};

export type ArbitrumWithdrawResult = {
  chainId: number;
  from: string;
  to: string;
  asset: "eth" | "weth" | "usdc" | "usdce";
  amount: string; // decimal string for UI echo
  amountWeiOrUnits: string; // wei for eth/weth, units for usdc/usdce
  txHash: string;
};

const wethIface = new Interface([
  "function withdraw(uint256 wad)",
  "function balanceOf(address) view returns (uint256)",
]);

const usdcIface = new Interface([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to,uint256 amount) returns (bool)",
]);

async function loadArbSigner(fromAddress: string, password?: string) {
  const from = fromAddress.toLowerCase();
  if (!isAddress(from)) throw new Error("Invalid from address");
  const provider = getArbitrumProvider();
  const keystoreJson = readKeystore(from);
  const wallet = await Wallet.fromEncryptedJson(keystoreJson, password ?? "");
  if (wallet.address.toLowerCase() !== from) {
    throw new Error("Keystore does not match the requested from address");
  }
  return { from, provider, signer: wallet.connect(provider) };
}

async function currentGasCostWei(
  provider: JsonRpcProvider,
  tx: { from: string; to: string; data?: string; value?: bigint },
) {
  const [feeData, gasLimit] = await Promise.all([
    provider.getFeeData(),
    // Important: set `from` explicitly. Many ERC-20s will revert if estimateGas
    // is simulated from the default zero-address (msg.sender == 0x0).
    provider.estimateGas(tx),
  ]);

  const price = feeData.maxFeePerGas ?? feeData.gasPrice;
  if (!price) throw new Error("Unable to determine gas price");

  // Small safety multiplier to reduce “insufficient funds” errors on fee spikes.
  const paddedGas = (gasLimit * BigInt(12)) / BigInt(10);
  return paddedGas * price;
}

export async function unwrapWethToEth(opts: {
  fromAddress: string;
  // WETH amount in decimal ETH string (e.g. "0.1") or "max".
  wethAmount: string;
  password?: string;
  // Keep at least this much ETH in the wallet for future gas (default "0.002").
  reserveEth?: string;
}): Promise<ArbitrumWithdrawResult> {
  const reserveEth = opts.reserveEth ?? "0.002";
  const { from, provider, signer } = await loadArbSigner(opts.fromAddress, opts.password);

  const reserveWei = parseEther(reserveEth);
  const ethLatest = await provider.getBalance(from, "latest");
  if (ethLatest <= reserveWei) {
    throw new Error(`Insufficient ETH for gas: latest ${formatEther(ethLatest)} ETH; reserve ${reserveEth} ETH`);
  }

  const wethBalRes = await provider.call({
    to: WETH_ARB,
    data: wethIface.encodeFunctionData("balanceOf", [from]),
  });
  const wethBalWei = (wethIface.decodeFunctionResult("balanceOf", wethBalRes) as unknown as [bigint])[0];

  let amountWei: bigint;
  if (opts.wethAmount.trim().toLowerCase() === "max") {
    amountWei = wethBalWei;
  } else {
    amountWei = parseEther(opts.wethAmount);
  }

  if (amountWei <= BigInt(0)) throw new Error("wethAmount must be > 0");
  if (amountWei > wethBalWei) throw new Error("wethAmount exceeds WETH balance");

  // Ensure we can still cover gas after the unwrap tx.
  const gasCost = await currentGasCostWei(provider, {
    from,
    to: WETH_ARB,
    data: wethIface.encodeFunctionData("withdraw", [amountWei]),
    value: BigInt(0),
  });
  if (ethLatest <= reserveWei + gasCost) {
    throw new Error("Insufficient ETH for gas after reserve");
  }

  const tx = await signer.sendTransaction({
    to: WETH_ARB,
    data: wethIface.encodeFunctionData("withdraw", [amountWei]),
    value: BigInt(0),
  });
  await tx.wait();

  return {
    chainId: ARB_CHAIN_ID,
    from,
    to: WETH_ARB,
    asset: "weth",
    amount: opts.wethAmount,
    amountWeiOrUnits: amountWei.toString(),
    txHash: tx.hash,
  };
}

export async function withdrawFromArbitrumWallet(opts: {
  fromAddress: string;
  toAddress: string;
  asset: "eth" | "weth" | "usdc" | "usdce";
  // Amount in decimal string for ETH/WETH (18dp), or units string for USDC/USDC.e (6dp), or "max".
  amount: string;
  password?: string;
  // Keep at least this much ETH in the wallet for future gas (default "0.002").
  reserveEth?: string;
}): Promise<ArbitrumWithdrawResult> {
  const reserveEth = opts.reserveEth ?? "0.002";
  const { from, provider, signer } = await loadArbSigner(opts.fromAddress, opts.password);

  const to = opts.toAddress;
  if (!isAddress(to)) throw new Error("Invalid to address");

  const reserveWei = parseEther(reserveEth);
  const ethLatest = await provider.getBalance(from, "latest");

  if (opts.asset === "eth") {
    const gasCost = await currentGasCostWei(provider, { from, to, value: BigInt(0) });
    const spendable = ethLatest > reserveWei + gasCost ? ethLatest - reserveWei - gasCost : BigInt(0);
    if (spendable <= BigInt(0)) throw new Error("No spendable ETH (after reserve + gas)");

    const amountWei =
      opts.amount.trim().toLowerCase() === "max" ? spendable : parseEther(opts.amount);
    if (amountWei <= BigInt(0)) throw new Error("amount must be > 0");
    if (amountWei > spendable) throw new Error("amount exceeds spendable ETH (after reserve + gas)");

    const tx = await signer.sendTransaction({ to, value: amountWei });
    await tx.wait();
    return {
      chainId: ARB_CHAIN_ID,
      from,
      to: to.toLowerCase(),
      asset: "eth",
      amount: opts.amount,
      amountWeiOrUnits: amountWei.toString(),
      txHash: tx.hash,
    };
  }

  if (opts.asset === "weth") {
    const wethBalRes = await provider.call({
      to: WETH_ARB,
      data: wethIface.encodeFunctionData("balanceOf", [from]),
    });
    const wethBalWei = (wethIface.decodeFunctionResult("balanceOf", wethBalRes) as unknown as [bigint])[0];
    const amountWei =
      opts.amount.trim().toLowerCase() === "max" ? wethBalWei : parseEther(opts.amount);
    if (amountWei <= BigInt(0)) throw new Error("amount must be > 0");
    if (amountWei > wethBalWei) throw new Error("amount exceeds WETH balance");

    const gasCost = await currentGasCostWei(provider, {
      from,
      to: WETH_ARB,
      data: usdcIface.encodeFunctionData("transfer", [to, amountWei]),
      value: BigInt(0),
    });
    if (ethLatest <= reserveWei + gasCost) throw new Error("Insufficient ETH for gas after reserve");

    const tx = await signer.sendTransaction({
      to: WETH_ARB,
      data: usdcIface.encodeFunctionData("transfer", [to, amountWei]),
      value: BigInt(0),
    });
    await tx.wait();
    return {
      chainId: ARB_CHAIN_ID,
      from,
      to: to.toLowerCase(),
      asset: "weth",
      amount: opts.amount,
      amountWeiOrUnits: amountWei.toString(),
      txHash: tx.hash,
    };
  }

  const token = opts.asset === "usdc" ? USDC_ARB : USDC_E_ARB;
  const balRes = await provider.call({
    to: token,
    data: usdcIface.encodeFunctionData("balanceOf", [from]),
  });
  const balUnits = (usdcIface.decodeFunctionResult("balanceOf", balRes) as unknown as [bigint])[0];

  // USDC tokens are 6 decimals: the UI passes raw units strings in most places,
  // but we also allow "max" for convenience.
  const amountUnits =
    opts.amount.trim().toLowerCase() === "max" ? balUnits : BigInt(opts.amount);
  if (amountUnits <= BigInt(0)) throw new Error("amount must be > 0");
  if (amountUnits > balUnits) throw new Error("amount exceeds token balance");

  const gasCost = await currentGasCostWei(provider, {
    from,
    to: token,
    data: usdcIface.encodeFunctionData("transfer", [to, amountUnits]),
    value: BigInt(0),
  });
  if (ethLatest <= reserveWei + gasCost) throw new Error("Insufficient ETH for gas after reserve");

  const tx = await signer.sendTransaction({
    to: token,
    data: usdcIface.encodeFunctionData("transfer", [to, amountUnits]),
    value: BigInt(0),
  });
  await tx.wait();

  return {
    chainId: ARB_CHAIN_ID,
    from,
    to: to.toLowerCase(),
    asset: opts.asset,
    amount: opts.amount,
    amountWeiOrUnits: amountUnits.toString(),
    txHash: tx.hash,
  };
}

function usdcTokenFor(token: "usdc" | "usdce") {
  return token === "usdc" ? USDC_ARB : USDC_E_ARB;
}

export async function depositUsdcToHyperliquid(opts: {
  fromAddress: string;
  token: "usdc" | "usdce";
  usdcUnits: string;
  password?: string;
}): Promise<UsdcDepositResult> {
  const from = opts.fromAddress.toLowerCase();
  if (!isAddress(from)) throw new Error("Invalid from address");

  const units = BigInt(opts.usdcUnits);
  if (units <= BigInt(0)) throw new Error("usdcUnits must be > 0");
  if (units < BigInt(5_000_000)) {
    throw new Error("Deposit amount is below the Hyperliquid minimum deposit (5 USDC)");
  }

  const provider = getArbitrumProvider();
  const keystoreJson = readKeystore(from);
  const wallet = await Wallet.fromEncryptedJson(keystoreJson, opts.password ?? "");
  if (wallet.address.toLowerCase() !== from) {
    throw new Error("Keystore does not match the requested from address");
  }
  const signer = wallet.connect(provider);

  const tokenAddr = usdcTokenFor(opts.token);

  // NOTE: Hyperliquid accepts USDC deposits on Arbitrum. Some users may hold USDC.e.
  // We allow transferring either, but the user should verify which token Hyperliquid
  // currently credits as a deposit.
  const balRes = await provider.call({
    to: tokenAddr,
    data: usdcIface.encodeFunctionData("balanceOf", [from]),
  });
  const bal = (usdcIface.decodeFunctionResult("balanceOf", balRes) as unknown as [bigint])[0];
  if (bal < units) throw new Error("Insufficient USDC balance");

  const tx = await signer.sendTransaction({
    to: tokenAddr,
    data: usdcIface.encodeFunctionData("transfer", [HYPERLIQUID_BRIDGE2_ARB, units]),
    value: BigInt(0),
  });
  await tx.wait();

  return {
    chainId: ARB_CHAIN_ID,
    from,
    token: opts.token,
    usdcUnits: units.toString(),
    depositTxHash: tx.hash,
  };
}
