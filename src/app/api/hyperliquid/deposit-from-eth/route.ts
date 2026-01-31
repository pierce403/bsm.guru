import { NextResponse } from "next/server";

import { swapEthToUsdcAndDepositToHyperliquid } from "@/lib/server/arbitrum";
import { logWalletEvent } from "@/lib/server/logs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function assertLocalWalletUsage(req: Request) {
  if (process.env.BSM_ALLOW_NONLOCAL_WALLET === "true") return;

  const host = req.headers.get("host") ?? "";
  const hostname = host.split(":")[0]?.toLowerCase();
  if (hostname === "localhost" || hostname === "127.0.0.1") return;

  throw new Error(
    "Wallet APIs are restricted to localhost by default. Set BSM_ALLOW_NONLOCAL_WALLET=true to override.",
  );
}

export async function POST(req: Request) {
  try {
    assertLocalWalletUsage(req);

    const body = (await req.json()) as {
      fromAddress?: unknown;
      ethAmount?: unknown;
      password?: unknown;
      slippageBps?: unknown;
      reserveEth?: unknown;
    };

    const fromAddress = typeof body.fromAddress === "string" ? body.fromAddress : "";
    const ethAmount = typeof body.ethAmount === "string" ? body.ethAmount : "";
    const password = typeof body.password === "string" ? body.password : undefined;

    const slippageBps =
      typeof body.slippageBps === "number" ? body.slippageBps : undefined;
    const reserveEth =
      typeof body.reserveEth === "string" ? body.reserveEth : undefined;

    if (!fromAddress || !ethAmount) {
      return NextResponse.json(
        { error: "fromAddress and ethAmount are required" },
        { status: 400 },
      );
    }

    const res = await swapEthToUsdcAndDepositToHyperliquid({
      fromAddress,
      ethAmount,
      password,
      slippageBps,
      reserveEth,
    });

    await logWalletEvent(req, {
      action: "hyperliquid.deposit_from_eth",
      ok: true,
      from: res.from,
      ethInWei: res.ethInWei,
      usdcOutUnits: res.usdcOutUnits,
      wrapTxHash: res.wrapTxHash,
      approveTxHash: res.approveTxHash,
      swapTxHash: res.swapTxHash,
      depositTxHash: res.depositTxHash,
    });

    return NextResponse.json({ ts: Date.now(), result: res });
  } catch (e) {
    await logWalletEvent(req, {
      action: "hyperliquid.deposit_from_eth",
      ok: false,
      error: e instanceof Error ? e.message : "Failed to deposit",
    });

    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to deposit" },
      { status: 400 },
    );
  }
}
