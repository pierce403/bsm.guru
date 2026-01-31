import { NextResponse } from "next/server";

import { unwrapWethToEth } from "@/lib/server/arbitrum";
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
      wethAmount?: unknown;
      password?: unknown;
      reserveEth?: unknown;
    };

    const fromAddress = typeof body.fromAddress === "string" ? body.fromAddress : "";
    const wethAmount = typeof body.wethAmount === "string" ? body.wethAmount : "";
    const password = typeof body.password === "string" ? body.password : undefined;
    const reserveEth = typeof body.reserveEth === "string" ? body.reserveEth : undefined;

    if (!fromAddress || !wethAmount) {
      return NextResponse.json(
        { error: "fromAddress and wethAmount are required" },
        { status: 400 },
      );
    }

    const res = await unwrapWethToEth({ fromAddress, wethAmount, password, reserveEth });

    await logWalletEvent(req, {
      action: "arbitrum.unwrap_weth",
      ok: true,
      from: res.from,
      amount: res.amountWeiOrUnits,
      txHash: res.txHash,
    });

    return NextResponse.json({ ts: Date.now(), result: res });
  } catch (e) {
    await logWalletEvent(req, {
      action: "arbitrum.unwrap_weth",
      ok: false,
      error: e instanceof Error ? e.message : "Failed to unwrap WETH",
    });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to unwrap WETH" },
      { status: 400 },
    );
  }
}

