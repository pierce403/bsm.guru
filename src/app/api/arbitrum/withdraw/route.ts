import { NextResponse } from "next/server";

import { withdrawFromArbitrumWallet } from "@/lib/server/arbitrum";
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
      toAddress?: unknown;
      asset?: unknown;
      amount?: unknown;
      password?: unknown;
      reserveEth?: unknown;
    };

    const fromAddress = typeof body.fromAddress === "string" ? body.fromAddress : "";
    const toAddress = typeof body.toAddress === "string" ? body.toAddress : "";
    const asset =
      body.asset === "eth" || body.asset === "weth" || body.asset === "usdc" || body.asset === "usdce"
        ? body.asset
        : "";
    const amount = typeof body.amount === "string" ? body.amount : "";
    const password = typeof body.password === "string" ? body.password : undefined;
    const reserveEth = typeof body.reserveEth === "string" ? body.reserveEth : undefined;

    if (!fromAddress || !toAddress || !asset || !amount) {
      return NextResponse.json(
        { error: "fromAddress, toAddress, asset, amount are required" },
        { status: 400 },
      );
    }

    const res = await withdrawFromArbitrumWallet({
      fromAddress,
      toAddress,
      asset,
      amount,
      password,
      reserveEth,
    });

    await logWalletEvent(req, {
      action: "arbitrum.withdraw",
      ok: true,
      from: res.from,
      to: res.to,
      asset: res.asset,
      amount: res.amountWeiOrUnits,
      txHash: res.txHash,
    });

    return NextResponse.json({ ts: Date.now(), result: res });
  } catch (e) {
    await logWalletEvent(req, {
      action: "arbitrum.withdraw",
      ok: false,
      error: e instanceof Error ? e.message : "Failed to withdraw",
    });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to withdraw" },
      { status: 400 },
    );
  }
}

