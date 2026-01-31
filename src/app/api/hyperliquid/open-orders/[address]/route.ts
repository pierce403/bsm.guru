import { NextResponse, type NextRequest } from "next/server";
import { isAddress } from "ethers";

import { hyperliquidInfo } from "@/lib/hyperliquid/info";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OpenOrder = {
  coin: string;
  oid: number;
  side: string;
  limitPx: string;
  sz: string;
  timestamp?: number;
  reduceOnly?: boolean;
  // API can add more fields over time.
  [k: string]: unknown;
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
    const [openOrders, frontendOpenOrders] = await Promise.all([
      hyperliquidInfo<OpenOrder[]>({ type: "openOrders", user }),
      hyperliquidInfo<OpenOrder[]>({ type: "frontendOpenOrders", user }),
    ]);

    const key = (o: OpenOrder) => `${o.coin}:${o.oid}`;
    const seen = new Set<string>();
    const merged: OpenOrder[] = [];
    for (const o of [...openOrders, ...frontendOpenOrders]) {
      const k = key(o);
      if (seen.has(k)) continue;
      seen.add(k);
      merged.push(o);
    }

    // Most recent first when timestamp exists.
    merged.sort((a, b) => (Number(b.timestamp ?? 0) || 0) - (Number(a.timestamp ?? 0) || 0));

    return NextResponse.json({ ts: Date.now(), user, orders: merged });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to fetch open orders" },
      { status: 400 },
    );
  }
}

