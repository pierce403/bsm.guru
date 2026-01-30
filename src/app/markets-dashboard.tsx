"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";

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

type Recommendation = {
  symbol: string;
  title: string;
  subtitle: string;
  rationale: string;
  stats: Array<{ label: string; value: string; tone?: "muted" | "good" | "bad" }>;
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
  const [aboutOpen, setAboutOpen] = useState(false);

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

  const recommendations = useMemo<Recommendation[]>(() => {
    const candidates = rows
      .filter((r) => r.sigma_move_24h !== null && r.realized_vol !== null)
      .map((r) => {
        const z = r.sigma_move_24h ?? 0;
        const abs = Math.abs(z);
        const liq = Math.log10((r.day_ntl_vlm ?? 1) + 1);
        const score = abs * (1 + liq);
        return { r, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(({ r }) => {
        const z = r.sigma_move_24h ?? 0;
        const abs = Math.abs(z);
        const tail = r.tail_prob_24h;
        const sigma = r.realized_vol;

        const direction = z >= 0 ? "Short" : "Long";
        const style =
          abs >= 2.5
            ? "Fade extreme move"
            : abs >= 1.75
              ? "Reversion watch"
              : "Flow-follow";

        const title = `${direction} ${r.symbol}`;
        const subtitle = style;

        const rationale =
          tail !== null && sigma !== null
            ? `24h move is ${abs.toFixed(2)}σ (tail p ${(tail * 100).toFixed(2)}%) with realized σ ${(sigma * 100).toFixed(1)}%.`
            : `24h move is ${abs.toFixed(2)}σ.`;

        const stats: Recommendation["stats"] = [
          {
            label: "Sigma move",
            value: z.toFixed(2),
            tone: abs >= 2.5 ? "bad" : abs >= 1.75 ? "muted" : "muted",
          },
          {
            label: "Tail p",
            value: tail === null ? "—" : `${(tail * 100).toFixed(2)}%`,
            tone: tail !== null && tail < 0.05 ? "bad" : "muted",
          },
          {
            label: "Realized σ",
            value: sigma === null ? "—" : `${(sigma * 100).toFixed(1)}%`,
            tone: "muted",
          },
          {
            label: "24h",
            value: r.ret_24h === null ? "—" : formatPercent(r.ret_24h),
            tone:
              r.ret_24h === null
                ? "muted"
                : r.ret_24h >= 0
                  ? "good"
                  : "bad",
          },
        ];

        return { symbol: r.symbol, title, subtitle, rationale, stats };
      });

    return candidates;
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
          <Button variant="ghost" onClick={() => setAboutOpen(true)}>
            About metrics
          </Button>
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

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-6">
          <div>
            <p className="text-sm font-medium text-foreground">
              Top 3 recommended positions
            </p>
            <p className="text-xs text-muted">
              Heuristic signals derived from the current metrics. Updates on every
              refresh.
            </p>
          </div>
          <p className="text-xs text-muted">
            Research only (not financial advice).
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {recommendations.map((rec) => (
            <Card key={rec.symbol} className="space-y-3">
              <div>
                <p className="font-display text-2xl tracking-tight text-foreground">
                  {rec.title}
                </p>
                <p className="text-sm text-muted">{rec.subtitle}</p>
              </div>
              <p className="text-sm leading-6 text-muted">{rec.rationale}</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {rec.stats.map((s) => (
                  <div
                    key={s.label}
                    className="rounded-2xl bg-background/60 p-3 ring-1 ring-border/80"
                  >
                    <p className="text-[11px] font-medium text-muted">
                      {s.label}
                    </p>
                    <p
                      className={[
                        "mt-1 font-mono text-sm",
                        s.tone === "good"
                          ? "text-success"
                          : s.tone === "bad"
                            ? "text-danger"
                            : "text-foreground",
                      ].join(" ")}
                    >
                      {s.value}
                    </p>
                  </div>
                ))}
              </div>
            </Card>
          ))}

          {recommendations.length === 0 ? (
            <Card className="md:col-span-3">
              <p className="text-sm text-muted">
                No recommendations yet (waiting for the DB to sync and produce
                metrics).
              </p>
            </Card>
          ) : null}
        </div>
      </section>

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

      <Modal
        open={aboutOpen}
        onClose={() => setAboutOpen(false)}
        title="How to read “Realized σ”, “Sigma move”, and “Tail p”"
      >
        <div className="space-y-6 text-sm leading-6 text-muted">
          <p>
            These fields are a quick way to standardize “how wild was today’s
            move?” across different coins. They’re not magic (crypto returns
            have fat tails), but they’re great for ranking markets and sizing
            risk.
          </p>

          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-[0.22em] text-foreground">
              Definitions
            </h3>
            <div className="space-y-3 rounded-2xl bg-background/60 p-4 ring-1 ring-border/80">
              <p>
                <span className="font-medium text-foreground">Realized σ</span>{" "}
                is the annualized realized volatility from recent candles (std
                dev of log returns, scaled to “per year”). Higher = the market
                has been whipping around lately.
              </p>
              <p>
                <span className="font-medium text-foreground">Sigma move</span>{" "}
                is the 24h log-return expressed in standard deviations:
              </p>
              <pre className="overflow-x-auto rounded-2xl bg-background/60 p-3 font-mono text-xs text-foreground ring-1 ring-border/80">
{`z = ln(mid / prevDayPx) / (σ * sqrt(1/365))`}
              </pre>
              <p>
                <span className="font-medium text-foreground">Tail p</span> is
                the two-sided “how extreme is this?” probability under a normal
                model:
              </p>
              <pre className="overflow-x-auto rounded-2xl bg-background/60 p-3 font-mono text-xs text-foreground ring-1 ring-border/80">
{`p = 2 * (1 - Φ(|z|))`}
              </pre>
              <p className="text-xs">
                Lower <span className="font-mono text-foreground">p</span>{" "}
                means the move is more extreme relative to recent volatility.
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-[0.22em] text-foreground">
              How people use this (practically)
            </h3>
            <div className="space-y-3 rounded-2xl bg-background/60 p-4 ring-1 ring-border/80">
              <p>
                <span className="font-medium text-foreground">
                  Find dislocations fast:
                </span>{" "}
                sort by <span className="font-mono text-foreground">|z|</span>{" "}
                or low tail p to see which markets are doing something unusual
                today.
              </p>
              <p>
                <span className="font-medium text-foreground">
                  Size risk consistently:
                </span>{" "}
                treat <span className="font-mono text-foreground">z</span> as a
                standardized shock. If you’re allocating across many coins,
                this helps avoid “oops I forgot this one moves 3x as much”.
              </p>
              <p>
                <span className="font-medium text-foreground">
                  Separate “big move” from “big surprise”:
                </span>{" "}
                a 5% day might be boring if realized σ is huge, but a 2% day can
                be a shock if realized σ is tiny.
              </p>
              <p>
                <span className="font-medium text-foreground">
                  Options (when wired in):
                </span>{" "}
                compare realized σ vs implied vol and use tail p / sigma-moves
                to sanity-check whether the option surface is “pricing the
                chaos” appropriately.
              </p>
            </div>
          </div>

          <p className="text-xs">
            For research only. Not financial advice. Extreme moves can continue
            (and “tail p” will underestimate that in fat-tailed markets).
          </p>
        </div>
      </Modal>
    </main>
  );
}
