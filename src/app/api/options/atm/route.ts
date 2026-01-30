import { NextResponse } from "next/server";

import { fetchDeribitAtmOptionSnapshot } from "@/lib/options/deribit";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = url.searchParams.get("symbol")?.toUpperCase() ?? null;
  const spotRaw = url.searchParams.get("spot");
  const spotUsd = spotRaw ? Number(spotRaw) : NaN;

  const targetDaysRaw = url.searchParams.get("targetDays");
  const minHoursRaw = url.searchParams.get("minHours");

  const targetDays = targetDaysRaw ? Number(targetDaysRaw) : undefined;
  const minHours = minHoursRaw ? Number(minHoursRaw) : undefined;

  if (!symbol) {
    return NextResponse.json(
      { error: "symbol is required" },
      { status: 400 },
    );
  }

  if (!Number.isFinite(spotUsd) || spotUsd <= 0) {
    return NextResponse.json(
      { error: "spot must be a positive number" },
      { status: 400 },
    );
  }

  const snap = await fetchDeribitAtmOptionSnapshot({
    symbol,
    spotUsd,
    targetDays,
    minHours,
  });

  return NextResponse.json({ ts: Date.now(), snap });
}

