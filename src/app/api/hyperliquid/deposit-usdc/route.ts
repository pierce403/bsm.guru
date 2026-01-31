import { NextResponse } from "next/server";

import { depositUsdcToHyperliquid } from "@/lib/server/arbitrum";
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
      token?: unknown;
      usdcUnits?: unknown;
      password?: unknown;
    };

    const fromAddress = typeof body.fromAddress === "string" ? body.fromAddress : "";
    const token =
      body.token === "usdc" || body.token === "usdce" ? body.token : null;
    const usdcUnits = typeof body.usdcUnits === "string" ? body.usdcUnits : "";
    const password = typeof body.password === "string" ? body.password : undefined;

    if (!fromAddress || !token || !usdcUnits) {
      return NextResponse.json(
        { error: "fromAddress, token, and usdcUnits are required" },
        { status: 400 },
      );
    }

    const res = await depositUsdcToHyperliquid({
      fromAddress,
      token,
      usdcUnits,
      password,
    });

    await logWalletEvent(req, {
      action: "hyperliquid.deposit_usdc",
      ok: true,
      from: res.from,
      token: res.token,
      usdcUnits: res.usdcUnits,
      depositTxHash: res.depositTxHash,
    });

    return NextResponse.json({ ts: Date.now(), result: res });
  } catch (e) {
    await logWalletEvent(req, {
      action: "hyperliquid.deposit_usdc",
      ok: false,
      error: e instanceof Error ? e.message : "Failed to deposit",
    });

    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to deposit" },
      { status: 400 },
    );
  }
}

