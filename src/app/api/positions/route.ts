import { NextResponse } from "next/server";

import { logTradeEvent } from "@/lib/server/logs";
import { listOpenPositions, openPosition, type PositionSide } from "@/lib/server/positions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function assertLocalTradingUsage(req: Request) {
  if (process.env.BSM_ALLOW_NONLOCAL_TRADE === "true") return;

  const host = req.headers.get("host") ?? "";
  const hostname = host.split(":")[0]?.toLowerCase();
  if (hostname === "localhost" || hostname === "127.0.0.1") return;

  throw new Error(
    "Trading APIs are restricted to localhost by default. Set BSM_ALLOW_NONLOCAL_TRADE=true to override.",
  );
}

export async function GET(req: Request) {
  try {
    assertLocalTradingUsage(req);
    const positions = listOpenPositions();
    return NextResponse.json({ ts: Date.now(), positions });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to list positions" },
      { status: 400 },
    );
  }
}

export async function POST(req: Request) {
  try {
    assertLocalTradingUsage(req);

    const body = (await req.json()) as {
      symbol?: unknown;
      side?: unknown;
      notional?: unknown;
      meta?: unknown;
    };

    const symbol = typeof body.symbol === "string" ? body.symbol : "";
    const side = body.side === "long" || body.side === "short" ? body.side : null;
    const notionalRaw =
      typeof body.notional === "number" ? body.notional : Number(body.notional);
    const notional = Number.isFinite(notionalRaw) ? notionalRaw : 1000;

    if (!side) throw new Error("side must be 'long' or 'short'");
    const pos = openPosition({
      symbol,
      side: side as PositionSide,
      notional,
      meta:
        body.meta && typeof body.meta === "object" && !Array.isArray(body.meta)
          ? (body.meta as Record<string, unknown>)
          : undefined,
    });

    await logTradeEvent(req, {
      action: "positions.open",
      ok: true,
      id: pos.id,
      symbol: pos.symbol,
      side: pos.side,
      notional: pos.notional,
      qty: pos.qty,
      entry_px: pos.entry_px,
    });

    return NextResponse.json({ ts: Date.now(), position: pos });
  } catch (e) {
    await logTradeEvent(req, {
      action: "positions.open",
      ok: false,
      error: e instanceof Error ? e.message : "Failed to open position",
    });

    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to open position" },
      { status: 400 },
    );
  }
}
