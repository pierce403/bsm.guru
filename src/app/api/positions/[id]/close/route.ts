import { NextResponse, type NextRequest } from "next/server";

import { logTradeEvent } from "@/lib/server/logs";
import { closePosition } from "@/lib/server/positions";

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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertLocalTradingUsage(req);

    const { id: idRaw } = await params;
    const id = Number(idRaw);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const pos = closePosition(id);

    await logTradeEvent(req, {
      action: "positions.close",
      ok: true,
      id: pos.id,
      symbol: pos.symbol,
      side: pos.side,
      exit_px: pos.exit_px,
      closed_pnl: pos.closed_pnl,
    });

    return NextResponse.json({ ts: Date.now(), position: pos });
  } catch (e) {
    await logTradeEvent(req, {
      action: "positions.close",
      ok: false,
      error: e instanceof Error ? e.message : "Failed to close position",
    });

    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to close position" },
      { status: 400 },
    );
  }
}

