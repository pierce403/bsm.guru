import { NextResponse } from "next/server";

import { getMeta } from "@/lib/hyperliquid/info";

export const dynamic = "force-dynamic";

export async function GET() {
  const meta = await getMeta();
  return NextResponse.json({ ts: Date.now(), meta });
}

