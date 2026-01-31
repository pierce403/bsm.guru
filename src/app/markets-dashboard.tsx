"use client";

import { useEffect, useMemo, useState } from "react";

import { PayoffProbabilityChart } from "@/components/charts/PayoffProbabilityChart";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";

const WALLET_LS_KEY = "bsm.selectedWallet";
const FREE_FUNDS_LS_PREFIX = "bsm.walletFreeUsdcOverride.";

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

type PositionSide = "long" | "short";

type WalletRow = {
  address: string;
  createdAt: number;
  downloadUrl: string;
};

type WalletsResponse = { ts: number; wallets: WalletRow[] } | { error: string };

type HyperliquidStateResponse =
  | {
      ts: number;
      user: string;
      perps: { withdrawable?: string };
    }
  | { error: string };

type OpenPosition = {
  id: number;
  symbol: string;
  side: PositionSide;
  notional: number;
  qty: number;
  entry_px: number;
  entry_ts: number;
  current_px: number | null;
  current_ts: number | null;
  realized_vol: number | null;
  sigma_move_24h: number | null;
  tail_prob_24h: number | null;
  ret_24h: number | null;
  pnl: number | null;
  pnl_pct: number | null;
  value: number | null;
  meta_json: string | null;
  health_score: number | null;
  health_label: string | null;
  health_action: "hold" | "review" | "exit" | "exit_now" | null;
};

type PositionsResponse = { ts: number; positions: OpenPosition[] };

type TradeProof = {
  hypurrscanAddressUrl: string;
  dexlyAddressUrl: string;
};

type EnterResponse =
  | {
      ts: number;
      position: OpenPosition;
      trade: {
        fill: { oid: number | null; avgPx: number; totalSz: number };
        proof: TradeProof;
      };
    }
  | { error: string };

type CloseResponse =
  | {
      ts: number;
      position: OpenPosition;
      trade: {
        fill: { oid: number | null; avgPx: number; totalSz: number };
        proof: TradeProof;
      };
    }
  | { ts: number; position: OpenPosition; trade: null }
  | { error: string };

type Recommendation = {
  symbol: string;
  side: PositionSide;
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
  if (!res.ok) {
    const msg = await (async () => {
      try {
        const j = (await res.json()) as unknown;
        if (j && typeof j === "object" && "error" in j) {
          const err = (j as Record<string, unknown>).error;
          if (typeof err === "string") return err;
        }
      } catch {
        // ignore
      }
      try {
        const t = await res.text();
        if (t.trim()) return t.trim();
      } catch {
        // ignore
      }
      return res.statusText || "Request failed";
    })();

    throw new Error(`Request failed: ${res.status}${msg ? ` - ${msg}` : ""}`);
  }
  return (await res.json()) as T;
}

async function fetchJsonNoThrow<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  return (await res.json()) as T;
}

function shortAddr(addr: string) {
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function MarketsDashboard() {
  const [rows, setRows] = useState<SummaryRow[]>([]);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [positions, setPositions] = useState<OpenPosition[]>([]);
  const [positionsErr, setPositionsErr] = useState<string | null>(null);
  const [enteringSymbol, setEnteringSymbol] = useState<string | null>(null);
  const [exitingId, setExitingId] = useState<number | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [chartSymbol, setChartSymbol] = useState<string | null>(null);
  const [activeWallet, setActiveWallet] = useState<string | null>(null);
  const [hlFreeUsdc, setHlFreeUsdc] = useState<number | null>(null);
  const [walletFreeUsdcOverride, setWalletFreeUsdcOverride] =
    useState<number | null>(null);
  const [walletFreeUsdcOverrideText, setWalletFreeUsdcOverrideText] =
    useState("");
  const [walletErr, setWalletErr] = useState<string | null>(null);
  const [enterRec, setEnterRec] = useState<Recommendation | null>(null);
  const [enterPct, setEnterPct] = useState(10);
  const [enterErr, setEnterErr] = useState<string | null>(null);
  const [lastTradeProof, setLastTradeProof] = useState<TradeProof | null>(null);

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

  async function refreshPositions() {
    try {
      const data = await fetchJson<PositionsResponse>("/api/positions", {
        cache: "no-store",
      });
      setPositions(data.positions);
      setPositionsErr(null);
    } catch (e) {
      setPositionsErr(
        e instanceof Error ? e.message : "Failed to load positions",
      );
      setPositions([]);
    }
  }

  async function refreshHyperliquidFreeFunds(address: string) {
    try {
      const data = await fetchJsonNoThrow<HyperliquidStateResponse>(
        `/api/hyperliquid/state/${address}`,
        { cache: "no-store" },
      );
      if ("error" in data) {
        setHlFreeUsdc(null);
        return;
      }
      const raw = data.perps.withdrawable ?? null;
      const n = raw === null ? NaN : Number(raw);
      setHlFreeUsdc(Number.isFinite(n) ? n : null);
    } catch {
      setHlFreeUsdc(null);
    }
  }

  async function refreshWalletSelection() {
    try {
      const data = await fetchJsonNoThrow<WalletsResponse>("/api/wallets", {
        cache: "no-store",
      });
      if ("error" in data) {
        setWalletErr(data.error);
        setActiveWallet(null);
        return null;
      }

      let selected: string | null = null;
      try {
        const saved = window.localStorage.getItem(WALLET_LS_KEY);
        if (saved && data.wallets.some((w) => w.address === saved)) selected = saved;
      } catch {
        // ignore
      }

      if (!selected) selected = data.wallets[0]?.address ?? null;

      setWalletErr(null);
      setActiveWallet(selected);

      if (selected) {
        try {
          window.localStorage.setItem(WALLET_LS_KEY, selected);
        } catch {
          // ignore
        }
      }

      return selected;
    } catch (e) {
      setWalletErr(e instanceof Error ? e.message : "Failed to load wallets");
      setActiveWallet(null);
      return null;
    }
  }

  async function enterPosition(opts: {
    symbol: string;
    side: PositionSide;
    notional: number;
    wallet: string;
    meta?: Record<string, unknown>;
  }) {
    setEnteringSymbol(opts.symbol);
    setEnterErr(null);
    setPositionsErr(null);
    try {
      const res = await fetchJson<EnterResponse>("/api/positions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol: opts.symbol,
          side: opts.side,
          notional: opts.notional,
          wallet: opts.wallet,
          meta: opts.meta,
        }),
      });
      if ("error" in res) throw new Error(res.error);
      setLastTradeProof(res.trade.proof);
      setEnterRec(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to enter position";
      setEnterErr(msg);
      setPositionsErr(msg);
    } finally {
      setEnteringSymbol(null);
      await refreshPositions();
    }
  }

  async function exitPosition(id: number) {
    setExitingId(id);
    setPositionsErr(null);
    try {
      const res = await fetchJson<CloseResponse>(`/api/positions/${id}/close`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if ("error" in res) throw new Error(res.error);
      if (res.trade) setLastTradeProof(res.trade.proof);
    } catch (e) {
      setPositionsErr(e instanceof Error ? e.message : "Failed to exit position");
    } finally {
      setExitingId(null);
      await refreshPositions();
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
      await refreshPositions();
    }
  }

  useEffect(() => {
    let alive = true;
    void Promise.all([refresh(), refreshPositions()]).finally(() => {
      if (!alive) return;
      setLoading(false);
    });

    const refreshId = window.setInterval(() => {
      void refresh();
      void refreshPositions();
    }, 10_000);
    const syncId = window.setInterval(() => void syncNow(), 600_000);

    return () => {
      alive = false;
      window.clearInterval(refreshId);
      window.clearInterval(syncId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void refreshWalletSelection();
  }, []);

  useEffect(() => {
    if (!activeWallet) {
      setHlFreeUsdc(null);
      setWalletFreeUsdcOverride(null);
      setWalletFreeUsdcOverrideText("");
      return;
    }

    try {
      const raw = window.localStorage.getItem(`${FREE_FUNDS_LS_PREFIX}${activeWallet}`);
      const n = raw === null ? NaN : Number(raw);
      setWalletFreeUsdcOverrideText(raw ?? "");
      setWalletFreeUsdcOverride(Number.isFinite(n) && n >= 0 ? n : null);
    } catch {
      setWalletFreeUsdcOverride(null);
      setWalletFreeUsdcOverrideText("");
    }

    void refreshHyperliquidFreeFunds(activeWallet);
    const id = window.setInterval(
      () => void refreshHyperliquidFreeFunds(activeWallet),
      15_000,
    );
    return () => window.clearInterval(id);
  }, [activeWallet]);

  const freeUsdc = walletFreeUsdcOverride ?? hlFreeUsdc;

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

        const side: PositionSide = z >= 0 ? "short" : "long";
        const direction = side === "short" ? "Short" : "Long";
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

        return { symbol: r.symbol, side, title, subtitle, rationale, stats };
      });

    return candidates;
  }, [rows]);

  const chartRow = useMemo(
    () => (chartSymbol ? rows.find((r) => r.symbol === chartSymbol) ?? null : null),
    [chartSymbol, rows],
  );

  const hasOpenBySymbol = useMemo(() => {
    const set = new Set<string>();
    for (const p of positions) set.add(p.symbol);
    return set;
  }, [positions]);

  return (
    <main className="space-y-8">
      <Card className="p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <p className="text-sm font-medium text-foreground">Open positions</p>
            <p className="text-xs text-muted">
              Local position tracker (mark-to-market off Hyperliquid mids).
            </p>
          </div>
          <p className="text-xs text-muted">
            {positions.length ? `${positions.length} open` : "none"}
          </p>
        </div>

        {positionsErr ? (
          <div className="px-6 pb-4 text-sm text-danger">{positionsErr}</div>
        ) : null}

        {positions.length === 0 ? (
          <div className="border-t border-border/60 px-6 py-5">
            <p className="text-sm text-muted">
              No open positions yet. Use “Enter position” on a recommendation to
              start tracking.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto border-t border-border/60">
            <table className="w-full border-separate border-spacing-0">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="px-6 py-3 font-medium">Asset</th>
                  <th className="px-6 py-3 font-medium">Side</th>
                  <th className="px-6 py-3 font-medium">Entry</th>
                  <th className="px-6 py-3 font-medium">Current</th>
                  <th className="px-6 py-3 font-medium">Value</th>
                  <th className="px-6 py-3 font-medium">Proof</th>
                  <th className="px-6 py-3 font-medium">Health</th>
                  <th className="px-6 py-3 font-medium">Exit</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {positions.map((p) => {
                  const tone =
                    p.side === "long" ? "text-success" : "text-danger";
                  const pnlTone =
                    p.pnl === null
                      ? "text-muted"
                      : p.pnl >= 0
                        ? "text-success"
                        : "text-danger";

                  const healthTone =
                    p.health_action === "exit_now" || p.health_action === "exit"
                      ? "text-danger"
                      : p.health_action === "review"
                        ? "text-accent2"
                        : p.health_action === "hold"
                          ? "text-success"
                          : "text-muted";

                  const proofUrl = (() => {
                    try {
                      const meta = p.meta_json
                        ? (JSON.parse(p.meta_json) as Record<string, unknown>)
                        : null;
                      const hl = meta && typeof meta.hl === "object" ? (meta.hl as Record<string, unknown>) : null;
                      const proof =
                        hl && typeof hl.proof === "object" ? (hl.proof as Record<string, unknown>) : null;
                      const url = proof ? proof.hypurrscanAddressUrl : null;
                      return typeof url === "string" ? url : null;
                    } catch {
                      return null;
                    }
                  })();

                  return (
                    <tr key={p.id} className="hover:bg-background/40">
                      <td className="border-t border-border/60 px-6 py-3 font-mono text-foreground">
                        {p.symbol}
                      </td>
                      <td
                        className={[
                          "border-t border-border/60 px-6 py-3 font-mono",
                          tone,
                        ].join(" ")}
                      >
                        {p.side.toUpperCase()}
                      </td>
                      <td className="border-t border-border/60 px-6 py-3 font-mono text-foreground">
                        {formatPx(p.entry_px)}
                      </td>
                      <td className="border-t border-border/60 px-6 py-3 font-mono text-foreground">
                        {p.current_px === null ? "—" : formatPx(p.current_px)}
                      </td>
                      <td className="border-t border-border/60 px-6 py-3">
                        <p className="font-mono text-foreground">
                          {p.value === null ? "—" : formatCompact(p.value)}
                        </p>
                        <p
                          className={[
                            "mt-1 text-[11px] font-mono",
                            pnlTone,
                          ].join(" ")}
                        >
                          {p.pnl === null
                            ? "pnl —"
                            : `pnl ${formatCompact(p.pnl)} (${p.pnl_pct === null ? "—" : formatPercent(p.pnl_pct)})`}
                        </p>
                      </td>

                      <td className="border-t border-border/60 px-6 py-3">
                        {proofUrl ? (
                          <a
                            href={proofUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-sm font-medium text-foreground underline decoration-border/80 underline-offset-4 hover:decoration-foreground"
                          >
                            Hypurrscan
                          </a>
                        ) : (
                          <span className="text-sm text-muted">—</span>
                        )}
                      </td>

                      <td className="border-t border-border/60 px-6 py-3">
                        <p
                          className={[
                            "font-mono text-sm",
                            healthTone,
                          ].join(" ")}
                        >
                          {p.health_label ?? "—"}
                        </p>
                        <p className="mt-1 text-[11px] font-mono text-muted">
                          {p.sigma_move_24h === null || p.tail_prob_24h === null
                            ? "z — • tail —"
                            : `z ${p.sigma_move_24h.toFixed(2)} • tail ${(p.tail_prob_24h * 100).toFixed(2)}%`}
                        </p>
                      </td>

                      <td className="border-t border-border/60 px-6 py-3">
                        <Button
                          variant={p.health_action === "exit_now" ? "primary" : "ghost"}
                          disabled={exitingId === p.id}
                          onClick={() => void exitPosition(p.id)}
                        >
                          {exitingId === p.id
                            ? "Exiting..."
                            : p.health_action === "exit_now"
                              ? "Exit now"
                              : "Exit"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

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

        {lastTradeProof ? (
          <Card className="flex flex-wrap items-center justify-between gap-3 bg-background/60">
            <p className="text-sm text-muted">Latest trade proof:</p>
            <div className="flex flex-wrap items-center gap-3">
              <a
                href={lastTradeProof.hypurrscanAddressUrl}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-medium text-foreground underline decoration-border/80 underline-offset-4 hover:decoration-foreground"
              >
                Hypurrscan
              </a>
              <a
                href={lastTradeProof.dexlyAddressUrl}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-medium text-foreground underline decoration-border/80 underline-offset-4 hover:decoration-foreground"
              >
                Dexly
              </a>
            </div>
          </Card>
        ) : null}

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

              <div className="flex items-center justify-between gap-3 pt-1">
                <Button
                  variant="soft"
                  disabled={
                    enteringSymbol !== null || hasOpenBySymbol.has(rec.symbol)
                  }
                  onClick={() => {
                    setEnterPct(10);
                    setEnterErr(null);
                    setEnterRec(rec);
                    void refreshWalletSelection();
                  }}
                >
                  {hasOpenBySymbol.has(rec.symbol)
                    ? "Position open"
                    : "Enter position"}
                </Button>
                <p className="text-xs text-muted">defaults to 10% of free USDC</p>
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
                <th className="border-t border-border/60 px-6 py-3 font-medium">
                  Chart
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
                    <td className="border-t border-border/60 px-6 py-3">
                      <button
                        type="button"
                        className="rounded-full bg-background/60 px-3 py-1.5 text-xs font-medium text-foreground ring-1 ring-border/80 transition hover:bg-background/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                        disabled={r.realized_vol === null || !Number.isFinite(r.mid)}
                        onClick={() => setChartSymbol(r.symbol)}
                      >
                        Chart
                      </button>
                    </td>
                  </tr>
                );
              })}

              {ranked.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
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
        open={!!enterRec}
        onClose={() => setEnterRec(null)}
        title={
          enterRec ? `Enter position: ${enterRec.title}` : "Enter position"
        }
      >
        {!enterRec ? null : (() => {
          const row = rows.find((r) => r.symbol === enterRec.symbol) ?? null;
          const spot = row?.mid ?? null;

          const pct = Math.min(Math.max(enterPct, 0), 100) / 100;
          const allocUsd = freeUsdc === null ? null : freeUsdc * pct;

          const qty =
            allocUsd === null || spot === null || spot <= 0
              ? null
              : allocUsd / spot;

          const canEnter =
            activeWallet !== null &&
            freeUsdc !== null &&
            freeUsdc > 0 &&
            spot !== null &&
            spot > 0 &&
            allocUsd !== null &&
            allocUsd > 0 &&
            !hasOpenBySymbol.has(enterRec.symbol) &&
            enteringSymbol === null;

          return (
            <div className="space-y-6">
              <div className="rounded-3xl bg-background/60 p-4 ring-1 ring-border/80">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted">Wallet</p>
                    <p className="font-mono text-sm text-foreground">
                      {activeWallet ? shortAddr(activeWallet) : "No wallet selected"}
                    </p>
                    {walletErr ? (
                      <p className="text-xs text-danger">{walletErr}</p>
                    ) : null}
                  </div>
                  <div className="space-y-1 text-right">
                    <p className="text-xs font-medium text-muted">Free funds (USDC)</p>
                    <p className="font-mono text-sm text-foreground">
                      {freeUsdc === null ? "—" : `$${formatCompact(freeUsdc)}`}
                    </p>
                    <p className="text-[11px] text-muted">
                      Hyperliquid withdrawable:{" "}
                      <span className="font-mono">
                        {hlFreeUsdc === null ? "—" : `$${formatCompact(hlFreeUsdc)}`}
                      </span>
                    </p>
                    <div className="mt-2 flex justify-end">
                      <div className="w-40">
                        <Input
                          inputMode="decimal"
                          placeholder="Override (optional)"
                          value={walletFreeUsdcOverrideText}
                          disabled={!activeWallet}
                          onChange={(e) => {
                            const next = e.target.value;
                            setWalletFreeUsdcOverrideText(next);

                            const trimmed = next.trim();
                            const n = trimmed.length === 0 ? null : Number(trimmed);
                            const ok = n !== null && Number.isFinite(n) && n >= 0;
                            setWalletFreeUsdcOverride(ok ? n : null);

                            if (!activeWallet) return;
                            try {
                              const key = `${FREE_FUNDS_LS_PREFIX}${activeWallet}`;
                              if (ok) window.localStorage.setItem(key, String(n));
                              else window.localStorage.removeItem(key);
                            } catch {
                              // ignore
                            }
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {!activeWallet ? (
                  <p className="mt-3 text-xs text-muted">
                    Create/select a wallet on the{" "}
                    <a
                      href="/wallet"
                      className="font-medium text-foreground underline decoration-border/80 underline-offset-4 hover:decoration-foreground"
                    >
                      Wallet
                    </a>{" "}
                    page to fund and size positions.
                  </p>
                ) : null}
              </div>

              <div className="space-y-4 rounded-3xl bg-background/60 p-4 ring-1 ring-border/80">
                <div className="flex items-end justify-between gap-6">
                  <div>
                    <p className="text-xs font-medium text-muted">
                      Allocation (% of free USDC)
                    </p>
                    <p className="mt-1 font-mono text-3xl text-foreground">
                      {enterPct}%
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="text-xs font-medium text-muted">Allocated</p>
                    <p className="mt-1 font-mono text-sm text-foreground">
                      {allocUsd === null ? "—" : `$${formatCompact(allocUsd)} USDC`}
                    </p>
                    <p className="mt-1 text-[11px] font-mono text-muted">
                      {allocUsd === null ? "≈ $— notional" : `≈ $${formatCompact(allocUsd)} notional`}
                    </p>
                  </div>
                </div>

                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={enterPct}
                  onChange={(e) => setEnterPct(Number(e.target.value))}
                  className="w-full"
                />

                <div className="grid grid-cols-4 gap-2">
                  {[5, 10, 25, 50].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setEnterPct(v)}
                      className="rounded-full bg-background/60 px-3 py-1.5 text-xs font-medium text-foreground ring-1 ring-border/80 transition hover:bg-background/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                    >
                      {v}%
                    </button>
                  ))}
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl bg-background/60 p-3 ring-1 ring-border/80">
                    <p className="text-[11px] font-medium text-muted">Entry mid</p>
                    <p className="mt-1 font-mono text-sm text-foreground">
                      {spot === null ? "—" : formatPx(spot)}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-background/60 p-3 ring-1 ring-border/80">
                    <p className="text-[11px] font-medium text-muted">Qty</p>
                    <p className="mt-1 font-mono text-sm text-foreground">
                      {qty === null ? "—" : qty.toFixed(6)}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-background/60 p-3 ring-1 ring-border/80">
                    <p className="text-[11px] font-medium text-muted">Side</p>
                    <p className="mt-1 font-mono text-sm text-foreground">
                      {enterRec.side.toUpperCase()}
                    </p>
                  </div>
                </div>
              </div>

              {enterErr ? (
                <div className="rounded-2xl bg-background/60 p-3 text-sm text-danger ring-1 ring-border/80">
                  {enterErr}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center justify-end gap-3">
                <Button variant="ghost" onClick={() => setEnterRec(null)}>
                  Cancel
                </Button>
                <Button
                  disabled={!canEnter}
                  onClick={() =>
                    void enterPosition({
                      symbol: enterRec.symbol,
                      side: enterRec.side,
                      notional: allocUsd ?? 0,
                      wallet: activeWallet ?? "",
                      meta: {
                        source: "recommendation",
                        subtitle: enterRec.subtitle,
                        wallet: activeWallet,
                        alloc_pct: enterPct,
                        free_usdc: freeUsdc,
                        alloc_usdc: allocUsd,
                        hl_withdrawable_usdc: hlFreeUsdc,
                      },
                    })
                  }
                >
                  {enteringSymbol ? "Entering..." : "Confirm enter"}
                </Button>
              </div>

              <p className="text-xs text-muted">
                This sends a real IOC order to Hyperliquid and records the fill
                locally for tracking.
              </p>
            </div>
          );
        })()}
      </Modal>

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
            </div>
          </div>

          <p className="text-xs">
            For research only. Not financial advice. Extreme moves can continue
            (and “tail p” will underestimate that in fat-tailed markets).
          </p>
        </div>
      </Modal>

      <Modal
        open={!!chartSymbol}
        onClose={() => setChartSymbol(null)}
        title={chartRow ? `${chartRow.symbol}: model payoff chart` : "Chart"}
      >
        {!chartRow ? (
          <p className="text-sm text-muted">No data.</p>
        ) : chartRow.realized_vol === null ? (
          <p className="text-sm text-muted">Not enough data for σ.</p>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              This chart is <span className="font-medium text-foreground">not random</span>.
              It uses the current Hyperliquid mid and realized σ computed from recent
              Hyperliquid candles, then assumes a lognormal distribution for the end
              price over the horizon.
              <span className="font-medium text-foreground"> Solid</span> = price density.
              <span className="font-medium text-foreground"> Dashed</span> = linear P/L for a
              1-unit long/short position. Shading shows P/L weighted by probability
              (green contributes positive model EV, red negative).
            </p>

            <div className="rounded-3xl bg-background/60 p-4 ring-1 ring-border/80">
              <PayoffProbabilityChart
                spot={chartRow.mid}
                sigma={chartRow.realized_vol}
                horizonDays={1}
                position={(chartRow.sigma_move_24h ?? 0) >= 0 ? "short" : "long"}
              />
            </div>

            <p className="text-xs text-muted">
              Caveats: this is a simple statistical model (lognormal) and does not
              include funding, fees, slippage, or liquidation dynamics.
            </p>
          </div>
        )}
      </Modal>
    </main>
  );
}
