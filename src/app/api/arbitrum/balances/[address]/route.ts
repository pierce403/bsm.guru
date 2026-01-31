import { NextResponse, type NextRequest } from "next/server";
import { isAddress } from "ethers";

import { getArbitrumBalances } from "@/lib/server/arbitrum";
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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  try {
    assertLocalWalletUsage(req);

    const { address } = await params;
    if (!isAddress(address)) {
      await logWalletEvent(req, {
        action: "arbitrum.balances.get",
        ok: false,
        address,
        error: "Invalid address",
      });
      return NextResponse.json({ error: "Invalid address" }, { status: 400 });
    }

    const balances = await getArbitrumBalances(address);
    await logWalletEvent(req, {
      action: "arbitrum.balances.get",
      ok: true,
      address: address.toLowerCase(),
    });
    return NextResponse.json({ ts: Date.now(), address: address.toLowerCase(), ...balances });
  } catch (e) {
    await logWalletEvent(req, {
      action: "arbitrum.balances.get",
      ok: false,
      error: e instanceof Error ? e.message : "Failed to fetch balances",
    });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to fetch balances" },
      { status: 400 },
    );
  }
}
