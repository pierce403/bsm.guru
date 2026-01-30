import { NextResponse } from "next/server";

import { getAllMids } from "@/lib/hyperliquid/info";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const coins = url.searchParams.get("coins");

  const mids = await getAllMids();
  if (!coins) return NextResponse.json({ ts: Date.now(), mids });

  const want = new Set(
    coins
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

  const filtered: Record<string, string> = {};
  for (const k of Object.keys(mids)) {
    if (want.has(k)) filtered[k] = mids[k];
  }

  return NextResponse.json({ ts: Date.now(), mids: filtered });
}

