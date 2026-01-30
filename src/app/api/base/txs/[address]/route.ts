import { NextResponse, type NextRequest } from "next/server";
import { isAddress } from "ethers";

import { getBaseTxs } from "@/lib/server/base";
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
      action: "base.txs.get",
      ok: false,
      address,
      error: "Invalid address",
    });
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  const limitRaw = req.nextUrl.searchParams.get("limit");
  const limit = (() => {
    const n = limitRaw ? Number(limitRaw) : 25;
    return Number.isFinite(n) ? Math.min(Math.max(Math.floor(n), 1), 200) : 25;
  })();

  try {
    const txs = await getBaseTxs(address, limit);
    await logWalletEvent(req, {
      action: "base.txs.get",
      ok: true,
      address,
      limit,
      count: txs.length,
    });
    return NextResponse.json({
      ts: Date.now(),
      address,
      explorer: process.env.BASE_EXPLORER_API_URL ?? "https://base.blockscout.com/api",
      txs,
    });
  } catch (e) {
    await logWalletEvent(req, {
      action: "base.txs.get",
      ok: false,
      address,
      limit,
      error:
        e instanceof Error
          ? e.message
          : "Failed to fetch transaction history",
    });
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? e.message
            : "Failed to fetch transaction history",
      },
      { status: 500 },
    );
  }
}
