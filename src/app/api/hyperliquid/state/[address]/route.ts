import { NextResponse, type NextRequest } from "next/server";
import { isAddress } from "ethers";

import { hyperliquidInfo } from "@/lib/hyperliquid/info";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SpotClearinghouseState = {
  balances: Array<{
    coin: string;
    token: number;
    hold: string;
    total: string;
    entryNtl: string;
  }>;
};

type ClearinghouseState = {
  // Keep loose typing; the API evolves. We only surface a couple fields.
  marginSummary?: { accountValue?: string; totalMarginUsed?: string };
  withdrawable?: string;
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;
  if (!isAddress(address)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  try {
    const user = address.toLowerCase();

    const [spot, perps] = await Promise.all([
      hyperliquidInfo<SpotClearinghouseState>({
        type: "spotClearinghouseState",
        user,
      }),
      hyperliquidInfo<ClearinghouseState>({
        type: "clearinghouseState",
        user,
      }),
    ]);

    return NextResponse.json({ ts: Date.now(), user, spot, perps });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error ? e.message : "Failed to fetch Hyperliquid state",
      },
      { status: 400 },
    );
  }
}

