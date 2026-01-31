import { NextResponse, type NextRequest } from "next/server";
import { Wallet, isAddress } from "ethers";

import { logTradeEvent } from "@/lib/server/logs";
import { readKeystore } from "@/lib/server/wallets";

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

type CancelReq = {
  wallet?: unknown;
  password?: unknown;
  // Cancel specific orders by (coin, oid).
  orders?: unknown;
  // Or cancel all orders (optionally filtered by a specific coin like "BTC-PERP").
  coin?: unknown;
};

type CancelOrder = { coin: string; oid: number };

export async function POST(req: NextRequest) {
  try {
    assertLocalTradingUsage(req);

    const body = (await req.json().catch(() => ({}))) as CancelReq;
    const wallet = typeof body.wallet === "string" ? body.wallet.toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const coin = typeof body.coin === "string" ? body.coin : null;

    if (!isAddress(wallet)) throw new Error("wallet is required");

    const orders: CancelOrder[] = Array.isArray(body.orders)
      ? (body.orders as unknown[]).flatMap((o) => {
          if (!o || typeof o !== "object") return [];
          const coin = (o as Record<string, unknown>).coin;
          const oid = (o as Record<string, unknown>).oid;
          if (typeof coin !== "string") return [];
          const n = typeof oid === "number" ? oid : Number(oid);
          if (!Number.isFinite(n) || n <= 0) return [];
          return [{ coin, oid: Math.floor(n) }];
        })
      : [];

    const keystoreJson = readKeystore(wallet);
    const signer = await Wallet.fromEncryptedJson(keystoreJson, password);
    if (signer.address.toLowerCase() !== wallet) {
      throw new Error("Keystore does not match the requested wallet address");
    }

    const { Hyperliquid } = await import("hyperliquid");
    const sdk = new Hyperliquid({
      enableWs: false,
      privateKey: signer.privateKey,
      testnet: process.env.HYPERLIQUID_TESTNET === "true",
    });

    let result: unknown;
    if (orders.length) {
      result = await sdk.exchange.cancelOrder(
        orders.map((o) => ({ coin: o.coin, o: o.oid })),
      );
    } else {
      // Use SDK helper which first fetches open orders and cancels them.
      // If coin is provided, only cancels that instrument.
      result = await sdk.custom.cancelAllOrders(coin ?? undefined);
    }

    await logTradeEvent(req, {
      action: "orders.cancel",
      ok: true,
      wallet,
      coin: coin ?? undefined,
      count: orders.length || undefined,
    });

    return NextResponse.json({ ts: Date.now(), wallet, result });
  } catch (e) {
    await logTradeEvent(req, {
      action: "orders.cancel",
      ok: false,
      error: e instanceof Error ? e.message : "Failed to cancel orders",
    });

    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to cancel orders" },
      { status: 400 },
    );
  }
}

