import "server-only";

import { Interface, JsonRpcProvider, Wallet, formatEther, isAddress, parseEther } from "ethers";

import { readKeystore } from "@/lib/server/wallets";

const ARB_CHAIN_ID = 42161;

// Common Arbitrum addresses (verify before changing; these are widely-used canonical deployments).
const WETH_ARB = "0x82af49447d8a07e3bd95bd0d56f35241523fbab1";
const USDC_ARB = "0xaf88d065e77c8cc2239327c5edb3a432268e5831"; // native USDC (6 decimals)
const USDC_E_ARB = "0xff970a61a04b1ca14834a43f5de4533ebddb5cc8"; // USDC.e (bridged) (6 decimals)
const UNISWAP_V3_QUOTER = "0xb27308f9f90d607463bb33ea1bebb41c27ce5ab6";
const UNISWAP_V3_SWAP_ROUTER_02 = "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45";

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

  const ethWei = await provider.getBalance(address);

  const erc20 = new Interface([
    "function balanceOf(address) view returns (uint256)",
    "function decimals() view returns (uint8)",
  ]);

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
    ethWei: ethWei.toString(),
    eth: formatEther(ethWei),
    usdcUnits: usdcWei.toString(),
    usdceUnits: usdceWei.toString(),
    // USDC is 6 decimals; keep raw units for UI formatting.
  };
}

export type EthToHyperliquidDepositResult = {
  chainId: number;
  from: string;
  ethInWei: string;
  usdcOutUnits: string;
  wrapTxHash: string;
  approveTxHash: string;
  swapTxHash: string;
  depositTxHash: string;
};

export type UsdcDepositResult = {
  chainId: number;
  from: string;
  token: "usdc" | "usdce";
  usdcUnits: string;
  depositTxHash: string;
};

const quoterIface = new Interface([
  "function quoteExactInputSingle(address tokenIn,address tokenOut,uint24 fee,uint256 amountIn,uint160 sqrtPriceLimitX96) returns (uint256 amountOut)",
]);

const routerIface = new Interface([
  "function exactInputSingle(tuple(address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
]);

const wethIface = new Interface([
  "function deposit() payable",
  "function approve(address spender,uint256 value) returns (bool)",
]);

const usdcIface = new Interface([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to,uint256 amount) returns (bool)",
]);

function usdcTokenFor(token: "usdc" | "usdce") {
  return token === "usdc" ? USDC_ARB : USDC_E_ARB;
}

function bpsToMul(bps: number) {
  const clamped = Math.min(Math.max(Math.floor(bps), 0), 10_000);
  return BigInt(10_000 - clamped);
}

async function quoteOut(provider: JsonRpcProvider, fee: number, amountInWei: bigint) {
  const data = quoterIface.encodeFunctionData("quoteExactInputSingle", [
    WETH_ARB,
    USDC_ARB,
    fee,
    amountInWei,
    0,
  ]);
  const res = await provider.call({ to: UNISWAP_V3_QUOTER, data });
  const decoded = quoterIface.decodeFunctionResult("quoteExactInputSingle", res) as unknown as [
    bigint,
  ];
  return decoded[0] ?? BigInt(0);
}

export async function swapEthToUsdcAndDepositToHyperliquid(opts: {
  fromAddress: string;
  // ETH amount in decimal string (e.g. "0.05")
  ethAmount: string;
  // Optional password if keystore is encrypted; empty/omitted for hot-wallet keystores.
  password?: string;
  // Slippage in bps for amountOutMinimum (default 50 = 0.50%).
  slippageBps?: number;
  // Keep at least this much ETH in the wallet for future gas (default "0.002").
  reserveEth?: string;
}): Promise<EthToHyperliquidDepositResult> {
  const from = opts.fromAddress.toLowerCase();
  if (!isAddress(from)) throw new Error("Invalid from address");

  const slippageBps = opts.slippageBps ?? 50;
  const reserveEth = opts.reserveEth ?? "0.002";

  const provider = getArbitrumProvider();
  const keystoreJson = readKeystore(from);
  const wallet = await Wallet.fromEncryptedJson(keystoreJson, opts.password ?? "");
  if (wallet.address.toLowerCase() !== from) {
    throw new Error("Keystore does not match the requested from address");
  }
  const signer = wallet.connect(provider);

  const balance = await provider.getBalance(from);
  const reserveWei = parseEther(reserveEth);
  if (balance <= reserveWei) throw new Error("Insufficient ETH (below reserve)");

  const ethInWei = parseEther(opts.ethAmount);
  if (ethInWei <= BigInt(0)) throw new Error("ethAmount must be > 0");
  if (ethInWei > balance - reserveWei) {
    throw new Error("ethAmount exceeds available balance (after reserve)");
  }

  // Quote two common pools and pick the better one.
  const [out500, out3000] = await Promise.all([
    quoteOut(provider, 500, ethInWei).catch(() => BigInt(0)),
    quoteOut(provider, 3000, ethInWei).catch(() => BigInt(0)),
  ]);
  const fee = out500 >= out3000 ? 500 : 3000;
  const quoted = out500 >= out3000 ? out500 : out3000;
  if (quoted <= BigInt(0)) throw new Error("Unable to quote swap");

  const minOut = (quoted * bpsToMul(slippageBps)) / BigInt(10_000);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

  const beforeBalRes = await provider.call({
    to: USDC_ARB,
    data: usdcIface.encodeFunctionData("balanceOf", [from]),
  });
  const usdcBefore = (usdcIface.decodeFunctionResult("balanceOf", beforeBalRes) as unknown as [
    bigint,
  ])[0];

  // SwapRouter expects ERC20 for tokenIn. Wrap ETH -> WETH, then approve router.
  const wrapTx = await signer.sendTransaction({
    to: WETH_ARB,
    data: wethIface.encodeFunctionData("deposit", []),
    value: ethInWei,
  });
  await wrapTx.wait();

  const approveTx = await signer.sendTransaction({
    to: WETH_ARB,
    data: wethIface.encodeFunctionData("approve", [
      UNISWAP_V3_SWAP_ROUTER_02,
      ethInWei,
    ]),
    value: BigInt(0),
  });
  await approveTx.wait();

  const swapData = routerIface.encodeFunctionData("exactInputSingle", [
    {
      tokenIn: WETH_ARB,
      tokenOut: USDC_ARB,
      fee,
      recipient: from,
      deadline,
      amountIn: ethInWei,
      amountOutMinimum: minOut,
      sqrtPriceLimitX96: 0,
    },
  ]);

  const swapTx = await signer.sendTransaction({
    to: UNISWAP_V3_SWAP_ROUTER_02,
    data: swapData,
    value: BigInt(0),
  });
  await swapTx.wait();

  const afterBalRes = await provider.call({
    to: USDC_ARB,
    data: usdcIface.encodeFunctionData("balanceOf", [from]),
  });
  const usdcAfter = (usdcIface.decodeFunctionResult("balanceOf", afterBalRes) as unknown as [
    bigint,
  ])[0];

  const usdcOut = usdcAfter - usdcBefore;
  if (usdcOut <= BigInt(0)) throw new Error("Swap produced no USDC");

  // Hyperliquid minimum deposit is typically 5 USDC.
  if (usdcOut < BigInt(5_000_000)) {
    throw new Error("USDC out is below the Hyperliquid minimum deposit (5 USDC)");
  }

  const depositData = usdcIface.encodeFunctionData("transfer", [
    HYPERLIQUID_BRIDGE2_ARB,
    usdcOut,
  ]);
  const depositTx = await signer.sendTransaction({
    to: USDC_ARB,
    data: depositData,
    value: BigInt(0),
  });
  await depositTx.wait();

  return {
    chainId: ARB_CHAIN_ID,
    from,
    ethInWei: ethInWei.toString(),
    usdcOutUnits: usdcOut.toString(),
    wrapTxHash: wrapTx.hash,
    approveTxHash: approveTx.hash,
    swapTxHash: swapTx.hash,
    depositTxHash: depositTx.hash,
  };
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
