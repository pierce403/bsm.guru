import { NextResponse, type NextRequest } from "next/server";
import { isAddress } from "ethers";

import { getBaseBalance } from "@/lib/server/base";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;
  if (!isAddress(address)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  try {
    const balance = await getBaseBalance(address);
    return NextResponse.json({ ts: Date.now(), address, ...balance });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to fetch balance" },
      { status: 500 },
    );
  }
}

