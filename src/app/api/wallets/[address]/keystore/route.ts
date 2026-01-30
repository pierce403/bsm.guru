import { NextResponse, type NextRequest } from "next/server";

import { isAddressLike, readKeystore } from "@/lib/server/wallets";

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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  try {
    assertLocalWalletUsage(req);

    const { address } = await params;
    if (!isAddressLike(address)) {
      return NextResponse.json({ error: "Invalid address" }, { status: 400 });
    }

    const json = readKeystore(address.toLowerCase());
    const filename = `bsm-wallet-${address.toLowerCase()}.json`;

    return new NextResponse(json, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to read keystore" },
      { status: 400 },
    );
  }
}
