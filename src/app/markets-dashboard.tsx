"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

type SummaryRow = {
  symbol: string;
  ts: number;
  mid: number;
  prev_day_px: number | null;
  day_ntl_vlm: number | null;
  realized_vol: number | null;
  sigma_move_24h: number | null;
  tail_prob_24h: number | null;
  ret_24h: number | null;
};

type SummaryResponse = {
  ts: number;
  lastSync: { ts: number } | null;
  rows: SummaryRow[];
};

function formatCompact(n: number) {
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toFixed(2);
}

function formatPx(n: number) {
  const abs = Math.abs(n);
  if (abs >= 10_000) return n.toFixed(0);
  if (abs >= 100) return n.toFixed(2);
  if (abs >= 1) return n.toFixed(4);
  return n.toFixed(6);
}

function formatPercent(n: number) {
  return `${(n * 100).toFixed(2)}%`;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return (await res.json()) as T;
}

export function MarketsDashboard() {
  const [rows, setRows] = useState<SummaryRow[]>([]);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const data = await fetchJson<SummaryResponse>("/api/markets/summary", {
        cache: "no-store",
      });
      setRows(data.rows);
      setLastSync(data.lastSync?.ts ?? null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load summary");
    } finally {
      setLoading(false);
    }
  }

  async function syncNow() {
    setSyncing(true);
    try {
      await fetchJson("/api/sync/hyperliquid", { method: "POST" });
    } catch {
      // ignore; summary call will surface errors if persistent
    } finally {
      setSyncing(false);
      await refresh();
    }
  }

  useEffect(() => {
    let alive = true;
    void refresh().finally(() => {
      if (!alive) return;
      setLoading(false);
    });

    const refreshId = window.setInterval(() => void refresh(), 10_000);
    const syncId = window.setInterval(() => void syncNow(), 60_000);

    return () => {
      alive = false;
      window.clearInterval(refreshId);
      window.clearInterval(syncId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ranked = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const az = Math.abs(a.sigma_move_24h ?? 0);
      const bz = Math.abs(b.sigma_move_24h ?? 0);
      return bz - az;
    });
    return copy;
  }, [rows]);

  return (
    <main className="space-y-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <h1 className="font-display text-4xl tracking-tight text-foreground">
            Hyperliquid Markets
          </h1>
          <p className="max-w-2xl text-base leading-7 text-muted">
            “Out of balance” is approximated as a 24h sigma-move under the BSM
            lognormal assumption using realized volatility from recent candles.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right text-xs text-muted">
            <p>DB sync</p>
            <p className="font-mono text-foreground">
              {lastSync ? new Date(lastSync).toLocaleTimeString() : "never"}
            </p>
          </div>
          <Button
            variant="soft"
            disabled={syncing}
            onClick={() => void syncNow()}
          >
            {syncing ? "Syncing..." : "Sync now"}
          </Button>
        </div>
      </header>

      {error ? (
        <Card className="bg-background/60 text-danger">
          <p className="text-sm">{error}</p>
          <p className="mt-2 text-xs text-muted">
            Tip: this page reads from a local SQLite DB. Run the app with
            `./run.sh` (it will sync in the background), or click “Sync now”.
          </p>
        </Card>
      ) : null}

      <Card className="p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <p className="text-sm font-medium text-foreground">Imbalance</p>
            <p className="text-xs text-muted">
              Sorted by absolute sigma-move (24h).
            </p>
          </div>
          <p className="text-xs text-muted">
            {loading ? "Loading…" : `${ranked.length} markets`}
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="border-t border-border/60 px-6 py-3 font-medium">
                  Asset
                </th>
                <th className="border-t border-border/60 px-6 py-3 font-medium">
                  Mid
                </th>
                <th className="border-t border-border/60 px-6 py-3 font-medium">
                  24h
                </th>
                <th className="border-t border-border/60 px-6 py-3 font-medium">
                  Realized σ
                </th>
                <th className="border-t border-border/60 px-6 py-3 font-medium">
                  Sigma move
                </th>
                <th className="border-t border-border/60 px-6 py-3 font-medium">
                  Tail p
                </th>
                <th className="border-t border-border/60 px-6 py-3 font-medium">
                  24h notional
                </th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {ranked.map((r) => {
                const z = r.sigma_move_24h;
                const abs = z === null ? null : Math.abs(z);
                const color =
                  abs === null
                    ? "text-muted"
                    : abs >= 3
                      ? "text-danger"
                      : abs >= 2
                        ? "text-accent2"
                        : "text-foreground";

                return (
                  <tr key={r.symbol} className="hover:bg-background/40">
                    <td className="border-t border-border/60 px-6 py-3 font-mono text-foreground">
                      {r.symbol}
                    </td>
                    <td className="border-t border-border/60 px-6 py-3 font-mono text-foreground">
                      {formatPx(r.mid)}
                    </td>
                    <td
                      className={[
                        "border-t border-border/60 px-6 py-3 font-mono",
                        r.ret_24h === null
                          ? "text-muted"
                          : r.ret_24h >= 0
                            ? "text-success"
                            : "text-danger",
                      ].join(" ")}
                    >
                      {r.ret_24h === null ? "—" : formatPercent(r.ret_24h)}
                    </td>
                    <td className="border-t border-border/60 px-6 py-3 font-mono text-muted">
                      {r.realized_vol === null
                        ? "—"
                        : `${(r.realized_vol * 100).toFixed(1)}%`}
                    </td>
                    <td
                      className={[
                        "border-t border-border/60 px-6 py-3 font-mono",
                        color,
                      ].join(" ")}
                    >
                      {z === null ? "—" : z.toFixed(2)}
                    </td>
                    <td className="border-t border-border/60 px-6 py-3 font-mono text-muted">
                      {r.tail_prob_24h === null
                        ? "—"
                        : `${(r.tail_prob_24h * 100).toFixed(2)}%`}
                    </td>
                    <td className="border-t border-border/60 px-6 py-3 font-mono text-muted">
                      {r.day_ntl_vlm === null ? "—" : formatCompact(r.day_ntl_vlm)}
                    </td>
                  </tr>
                );
              })}

              {ranked.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="border-t border-border/60 px-6 py-6 text-sm text-muted"
                  >
                    No data yet. Click “Sync now” to populate the local DB.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>
    </main>
  );
}
