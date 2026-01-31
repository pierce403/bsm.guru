import { NextResponse } from "next/server";
import { Wallet, isAddress } from "ethers";

import { readKeystore } from "@/lib/server/wallets";
import { logWalletEvent } from "@/lib/server/logs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function assertLocalWalletUsage(req: Request) {
  if (process.env.BSM_ALLOW_NONLOCAL_WALLET === "true") return;

  const host = req.headers.get("host") ?? "";
  const hostname = host.split(":")[0]?.toLowerCase();
  if (hostname === "localhost" || hostname === "127.0.0.1") return;

  throw new Error(
    "Wallet APIs are restricted to localhost by default. Set BSM_ALLOW_NONLOCAL_WALLET=true to override.",
  );
}

export async function POST(req: Request) {
  try {
    assertLocalWalletUsage(req);

    const body = (await req.json()) as {
      wallet?: unknown;
      destination?: unknown;
      amount?: unknown;
      password?: unknown;
    };

    const walletAddress = typeof body.wallet === "string" ? body.wallet : "";
    const destination = typeof body.destination === "string" ? body.destination : "";
    const password = typeof body.password === "string" ? body.password : undefined;

    const amountStr = typeof body.amount === "string" ? body.amount : String(body.amount ?? "");
    const amountNum = Number(amountStr);
    const amount = Math.round(amountNum * 1_000_000) / 1_000_000; // up to 6dp for USDC

    if (!isAddress(walletAddress)) {
      return NextResponse.json({ error: "Invalid wallet address" }, { status: 400 });
    }
    if (!isAddress(destination)) {
      return NextResponse.json({ error: "Invalid destination address" }, { status: 400 });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 });
    }

    const keystoreJson = readKeystore(walletAddress.toLowerCase());
    const signer = await Wallet.fromEncryptedJson(keystoreJson, password ?? "");
    if (signer.address.toLowerCase() !== walletAddress.toLowerCase()) {
      throw new Error("Keystore does not match the requested wallet address");
    }

    const { Hyperliquid } = await import("hyperliquid");
    const sdk = new Hyperliquid({
      enableWs: false,
      privateKey: signer.privateKey,
      testnet: process.env.HYPERLIQUID_TESTNET === "true",
    });

    const result = await sdk.exchange.initiateWithdrawal(destination, amount);

    await logWalletEvent(req, {
      action: "hyperliquid.withdraw_usdc",
      ok: true,
      wallet: walletAddress.toLowerCase(),
      destination: destination.toLowerCase(),
      amount,
    });

    return NextResponse.json({
      ts: Date.now(),
      wallet: walletAddress.toLowerCase(),
      destination: destination.toLowerCase(),
      amount,
      hypurrscanDestinationUrl: `https://hypurrscan.io/address/${destination.toLowerCase()}`,
      result,
    });
  } catch (e) {
    await logWalletEvent(req, {
      action: "hyperliquid.withdraw_usdc",
      ok: false,
      error: e instanceof Error ? e.message : "Failed to initiate withdrawal",
    });

    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to initiate withdrawal" },
      { status: 400 },
    );
  }
}

