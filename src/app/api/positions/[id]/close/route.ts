import { NextResponse, type NextRequest } from "next/server";

import { logTradeEvent } from "@/lib/server/logs";
import { closePosition, closePositionWithExit, getPositionById } from "@/lib/server/positions";
import { closePerpIocOrder } from "@/lib/server/hyperliquid-trading";

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

    const existing = getPositionById(id);
    if (!existing) return NextResponse.json({ error: "Position not found" }, { status: 404 });
    if (existing.status !== "open") return NextResponse.json({ error: "Position is not open" }, { status: 400 });

    const meta = (() => {
      try {
        return existing.meta_json ? (JSON.parse(existing.meta_json) as Record<string, unknown>) : {};
      } catch {
        return {};
      }
    })();
    const wallet = typeof meta.wallet === "string" ? meta.wallet : "";
    const hl = meta.hl && typeof meta.hl === "object" ? (meta.hl as Record<string, unknown>) : null;
    const hlMode = hl && typeof hl.mode === "string" ? hl.mode : null;
    const tradingMode = (process.env.BSM_TRADING_MODE ?? "").toLowerCase();

    // Legacy/local-only positions (pre-trading), or mock-trading positions (tests),
    // cannot be closed on Hyperliquid. Close locally instead.
    //
    // Important nuance:
    // - In Playwright (BSM_TRADING_MODE=mock) we still want to return mock trade + proof.
    // - In normal local usage, a mock/legacy position should close locally.
    if (!wallet || !hl || !hlMode || (hlMode !== "real" && tradingMode !== "mock")) {
      const pos = (() => {
        try {
          return closePosition(id);
        } catch (e) {
          // Local-only positions for non-HL symbols (e.g. tests) won't have a DB mid.
          // Close them at entry price (pnl=0) rather than failing.
          const msg = e instanceof Error ? e.message : "";
          if (msg.includes("No mid price for")) {
            return closePositionWithExit({ id, exitPx: existing.entry_px, exitTs: Date.now() });
          }
          throw e;
        }
      })();
      await logTradeEvent(req, {
        action: "positions.close",
        ok: true,
        id: pos.id,
        symbol: pos.symbol,
        side: pos.side,
        exit_px: pos.exit_px,
        closed_pnl: pos.closed_pnl,
        note: "closed locally (no Hyperliquid trade)",
      });
      return NextResponse.json({ ts: Date.now(), position: pos, trade: null });
    }

    const closeSide = existing.side === "long" ? "sell" : "buy";
    const trade = await closePerpIocOrder({
      walletAddress: wallet,
      symbol: existing.symbol,
      qty: existing.qty,
      closeSide,
    });

    const pos = closePositionWithExit({
      id,
      exitPx: trade.fill.avgPx,
      exitTs: Date.now(),
    });

    await logTradeEvent(req, {
      action: "positions.close",
      ok: true,
      id: pos.id,
      symbol: pos.symbol,
      side: pos.side,
      exit_px: pos.exit_px,
      closed_pnl: pos.closed_pnl,
      hl_oid: trade.fill.oid,
      proof: trade.proof,
    });

    return NextResponse.json({
      ts: Date.now(),
      position: pos,
      trade: { fill: trade.fill, proof: trade.proof },
    });
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
