import { NextResponse, type NextRequest } from "next/server";
import { isAddress } from "ethers";

import { getBaseBalance } from "@/lib/server/base";
import { logWalletEvent } from "@/lib/server/logs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;
  if (!isAddress(address)) {
    await logWalletEvent(req, {
      action: "base.balance.get",
      ok: false,
      address,
      error: "Invalid address",
    });
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  try {
    const balance = await getBaseBalance(address);
    await logWalletEvent(req, {
      action: "base.balance.get",
      ok: true,
      address,
    });
    return NextResponse.json({ ts: Date.now(), address, ...balance });
  } catch (e) {
    await logWalletEvent(req, {
      action: "base.balance.get",
      ok: false,
      address,
      error: e instanceof Error ? e.message : "Failed to fetch balance",
    });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to fetch balance" },
      { status: 500 },
    );
  }
}
