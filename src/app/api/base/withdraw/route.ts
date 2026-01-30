import { NextResponse } from "next/server";

import { withdrawAllBaseEth } from "@/lib/server/base";
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
      password?: unknown;
    };

    const fromAddress =
      typeof body.fromAddress === "string" ? body.fromAddress : "";
    const toAddress = typeof body.toAddress === "string" ? body.toAddress : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!fromAddress || !toAddress) {
      return NextResponse.json(
        { error: "fromAddress and toAddress are required" },
        { status: 400 },
      );
    }
    if (!password) {
      return NextResponse.json(
        { error: "password is required" },
        { status: 400 },
      );
    }

    const tx = await withdrawAllBaseEth({ fromAddress, toAddress, password });

    await logWalletEvent(req, {
      action: "base.withdraw_all",
      ok: true,
      from: tx.from,
      to: tx.to,
      valueEth: tx.valueEth,
      txHash: tx.txHash,
    });

    return NextResponse.json({ ts: Date.now(), tx });
  } catch (e) {
    await logWalletEvent(req, {
      action: "base.withdraw_all",
      ok: false,
      error: e instanceof Error ? e.message : "Failed to withdraw",
    });

    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to withdraw" },
      { status: 400 },
    );
  }
}

