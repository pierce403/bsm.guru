import { NextResponse } from "next/server";

import { logWalletEvent } from "@/lib/server/logs";
import { createWallet, listWallets } from "@/lib/server/wallets";

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

export async function GET(req: Request) {
  try {
    assertLocalWalletUsage(req);

    const wallets = listWallets().map((w) => ({
      address: w.address,
      createdAt: w.createdAt,
      downloadUrl: `/api/wallets/${w.address}/keystore`,
    }));

    await logWalletEvent(req, {
      action: "wallets.list",
      ok: true,
      count: wallets.length,
    });

    return NextResponse.json({ ts: Date.now(), wallets });
  } catch (e) {
    await logWalletEvent(req, {
      action: "wallets.list",
      ok: false,
      error: e instanceof Error ? e.message : "Failed to list wallets",
    });

    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to list wallets" },
      { status: 400 },
    );
  }
}

export async function POST(req: Request) {
  try {
    assertLocalWalletUsage(req);

    const body = (await req.json().catch(() => ({}))) as { password?: unknown };
    const password = typeof body.password === "string" ? body.password : "";
    const wallet = await createWallet({ password });

    await logWalletEvent(req, {
      action: "wallets.create",
      ok: true,
      address: wallet.address,
    });

    return NextResponse.json({
      ts: Date.now(),
      wallet: {
        address: wallet.address,
        createdAt: wallet.createdAt,
        downloadUrl: `/api/wallets/${wallet.address}/keystore`,
      },
    });
  } catch (e) {
    await logWalletEvent(req, {
      action: "wallets.create",
      ok: false,
      error: e instanceof Error ? e.message : "Failed to create wallet",
    });

    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to create wallet" },
      { status: 400 },
    );
  }
}
