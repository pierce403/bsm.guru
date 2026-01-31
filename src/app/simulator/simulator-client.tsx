"use client";

import { useEffect, useMemo, useState } from "react";

import { EquityCurveChart } from "@/components/charts/EquityCurveChart";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";

type SummaryResponse =
  | {
      ts: number;
      lastSync: { ts: number } | null;
      rows: Array<{ symbol: string }>;
    }
  | { error: string };

type BacktestSummary = {
  startingCash: number;
  endingEquity: number;
  totalReturn: number;
  tradeCount: number;
  winRate: number | null;
  avgPnl: number | null;
  profitFactor: number | null;
  maxDrawdown: number;
  maxDrawdownPct: number | null;
};

type BacktestTrade = {
  side: "long" | "short";
  entryTime: number;
  exitTime: number;
  totalPnl: number;
  pnlPx: number;
  fundingPnl: number;
  holdSteps: number;
  exitReason: string;
};

type BacktestPoint = { time: number; equity: number; price: number };

type SimulateResponse =
  | {
      ts: number;
      mode: "mock" | "live";
      symbol: string;
      interval: string;
      startTime: number;
      endTime: number;
      candles?: { fetched: boolean; rows: number; points: number };
      funding?: { fetched: boolean; rows: number; points: number };
      result: {
        summary: BacktestSummary;
        trades: BacktestTrade[];
        equity: BacktestPoint[];
      };
    }
  | { error: string };

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const json = (await res.json()) as T;
  if (!res.ok) {
    const msg = (() => {
      if (json && typeof json === "object" && "error" in (json as Record<string, unknown>)) {
        const err = (json as Record<string, unknown>).error;
        if (typeof err === "string" && err.trim()) return err;
      }
      return "Request failed";
    })();
    throw new Error(msg);
  }
  return json;
}

function formatCompact(n: number) {
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toFixed(2);
}

function formatMoney(n: number) {
  return `$${formatCompact(n)}`;
}

function formatPct(n: number | null) {
  if (n === null || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(2)}%`;
}

function formatTs(ts: number) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

export function SimulatorClient() {
  const [symbols, setSymbols] = useState<string[]>([]);
  const [lastSync, setLastSync] = useState<number | null>(null);

  const [symbol, setSymbol] = useState("ETH");
  const [interval, setInterval] = useState("1h");
  const [lookbackDays, setLookbackDays] = useState("14");

  const [strategy, setStrategy] = useState<"contrarian" | "momentum">("contrarian");
  const [startingCash, setStartingCash] = useState("10000");
  const [tradeNotional, setTradeNotional] = useState("1000");
  const [slippageBps, setSlippageBps] = useState("0");
  const [useFunding, setUseFunding] = useState(true);
  const [enterAbsZ, setEnterAbsZ] = useState("2.0");
  const [exitAbsZ, setExitAbsZ] = useState("0.5");
  const [zLookbackSteps, setZLookbackSteps] = useState("");
  const [volWindowReturns, setVolWindowReturns] = useState("48");
  const [maxHoldSteps, setMaxHoldSteps] = useState("");
  const [minCrowding, setMinCrowding] = useState("");

  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<SimulateResponse | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const data = await fetchJson<SummaryResponse>("/api/markets/summary?limit=200", {
          cache: "no-store",
        });
        if (!alive) return;
        if ("error" in data) return;
        setSymbols(data.rows.map((r) => r.symbol));
        setLastSync(data.lastSync?.ts ?? null);
      } catch {
        // ignore; simulator can still run with manual symbols
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const derived = useMemo(() => {
    const days = Number(lookbackDays);
    const okDays = Number.isFinite(days) && days > 0 ? days : 14;
    const end = Date.now();
    const start = end - okDays * 24 * 60 * 60 * 1000;
    return { start, end, days: okDays };
  }, [lookbackDays]);

  async function run() {
    setRunning(true);
    setErr(null);
    setRes(null);
    try {
      const days = derived.days;
      const sc = Number(startingCash);
      const tn = Number(tradeNotional);
      const sbps = Number(slippageBps);
      const enter = Number(enterAbsZ);
      const exit = Number(exitAbsZ);

      const zSteps = zLookbackSteps.trim().length ? Number(zLookbackSteps) : undefined;
      const volWin = Number(volWindowReturns);
      const maxHold = maxHoldSteps.trim().length ? Number(maxHoldSteps) : undefined;
      const minCrowd = minCrowding.trim().length ? Number(minCrowding) : undefined;

      if (!symbol.trim()) throw new Error("Enter a symbol");
      if (!Number.isFinite(sc) || sc <= 0) throw new Error("Invalid starting cash");
      if (!Number.isFinite(tn) || tn <= 0) throw new Error("Invalid trade notional");
      if (!Number.isFinite(sbps) || sbps < 0) throw new Error("Invalid slippage");
      if (!Number.isFinite(enter) || enter <= 0) throw new Error("Invalid enter abs Z");
      if (!Number.isFinite(exit) || exit < 0) throw new Error("Invalid exit abs Z");
      if (!Number.isFinite(days) || days <= 0) throw new Error("Invalid lookback days");
      if (!Number.isFinite(volWin) || volWin < 2) throw new Error("Invalid vol window");

      const payload: Record<string, unknown> = {
        symbol: symbol.toUpperCase(),
        interval,
        startTime: derived.start,
        endTime: derived.end,
        strategy,
        startingCash: sc,
        tradeNotional: tn,
        slippageBps: sbps,
        useFunding,
        enterAbsZ: enter,
        exitAbsZ: exit,
        volWindowReturns: volWin,
      };

      if (zSteps !== undefined) payload.zLookbackSteps = zSteps;
      if (maxHold !== undefined) payload.maxHoldSteps = maxHold;
      if (minCrowd !== undefined) payload.minCrowding = minCrowd;

      const data = await fetchJson<SimulateResponse>("/api/simulate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      setRes(data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to simulate");
    } finally {
      setRunning(false);
    }
  }

  const chartPoints = useMemo(() => {
    if (!res || "error" in res) return [];
    return (res.result.equity ?? []).map((p) => ({ time: p.time, equity: p.equity }));
  }, [res]);

  return (
    <main className="space-y-8">
      <header className="space-y-2">
        <h1 className="font-display text-4xl tracking-tight text-foreground">
          Strategy simulator
        </h1>
        <p className="max-w-3xl text-base leading-7 text-muted">
          Backtest simple perp strategies on historical candles and funding history. This is a
          research tool: it ignores many real-world effects (fees, liquidations, latency, spread).
          Verify assumptions before risking capital.
        </p>
        <p className="text-xs text-muted">
          Data source: Hyperliquid public API. Cache: local SQLite.{" "}
          {lastSync ? (
            <>
              Last DB sync: <span className="font-mono text-foreground">{formatTs(lastSync)}</span>.
            </>
          ) : (
            "DB sync time unknown."
          )}
        </p>
      </header>

      <Card className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-foreground">Backtest inputs</p>
            <p className="text-xs text-muted">Run once, inspect, iterate.</p>
          </div>
          <Button variant="soft" disabled={running} onClick={() => void run()}>
            {running ? "Running..." : "Run simulation"}
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted">Symbol</label>
            <Input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="ETH" list="hl-symbols" />
            <datalist id="hl-symbols">
              {symbols.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted">Interval</label>
            <select
              className="h-10 w-full rounded-2xl bg-background/60 px-3 text-sm text-foreground ring-1 ring-border/80"
              value={interval}
              onChange={(e) => setInterval(e.target.value)}
            >
              <option value="15m">15m</option>
              <option value="1h">1h</option>
              <option value="4h">4h</option>
              <option value="1d">1d</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted">Lookback (days)</label>
            <Input value={lookbackDays} onChange={(e) => setLookbackDays(e.target.value)} placeholder="14" inputMode="numeric" />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted">Strategy</label>
            <select
              className="h-10 w-full rounded-2xl bg-background/60 px-3 text-sm text-foreground ring-1 ring-border/80"
              value={strategy}
              onChange={(e) => setStrategy(e.target.value as typeof strategy)}
            >
              <option value="contrarian">Contrarian (fade)</option>
              <option value="momentum">Momentum (follow)</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted">Starting cash (USDC)</label>
            <Input value={startingCash} onChange={(e) => setStartingCash(e.target.value)} inputMode="decimal" />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted">Trade notional (USDC)</label>
            <Input value={tradeNotional} onChange={(e) => setTradeNotional(e.target.value)} inputMode="decimal" />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted">Enter |Z|</label>
            <Input value={enterAbsZ} onChange={(e) => setEnterAbsZ(e.target.value)} inputMode="decimal" />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted">Exit |Z|</label>
            <Input value={exitAbsZ} onChange={(e) => setExitAbsZ(e.target.value)} inputMode="decimal" />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted">Slippage (bps)</label>
            <Input value={slippageBps} onChange={(e) => setSlippageBps(e.target.value)} inputMode="numeric" />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted">Vol window (returns)</label>
            <Input value={volWindowReturns} onChange={(e) => setVolWindowReturns(e.target.value)} inputMode="numeric" />
            <p className="text-[11px] text-muted">Example: 48 = 2 days on 1h candles.</p>
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted">Z lookback (steps, optional)</label>
            <Input value={zLookbackSteps} onChange={(e) => setZLookbackSteps(e.target.value)} inputMode="numeric" placeholder="(default = ~24h)" />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted">Max hold (steps, optional)</label>
            <Input value={maxHoldSteps} onChange={(e) => setMaxHoldSteps(e.target.value)} inputMode="numeric" placeholder="(default = ~7x lookback)" />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted">Min crowding (optional)</label>
            <Input value={minCrowding} onChange={(e) => setMinCrowding(e.target.value)} inputMode="decimal" placeholder="e.g. 1.1" />
            <p className="text-[11px] text-muted">If set, only enter when funding/premium align with the signal.</p>
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted">Funding</label>
            <label className="mt-2 flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={useFunding}
                onChange={(e) => setUseFunding(e.target.checked)}
              />
              Include funding carry in PnL
            </label>
            <p className="text-[11px] text-muted">Funding is approximated and aligned to candle steps.</p>
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted">Range</label>
            <p className="mt-2 font-mono text-xs text-foreground">
              {formatTs(derived.start)} → {formatTs(derived.end)}
            </p>
            <p className="text-[11px] text-muted">Computed from lookback days.</p>
          </div>
        </div>

        {err ? (
          <div className="rounded-2xl bg-background/60 p-3 text-sm text-danger ring-1 ring-border/80">
            {err}
          </div>
        ) : null}
      </Card>

      {res && !("error" in res) ? (
        <section className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <Card className="space-y-1">
              <p className="text-xs font-medium text-muted">Result</p>
              <p className="font-mono text-sm text-foreground">
                {res.mode.toUpperCase()} • {res.symbol} • {res.interval}
              </p>
              <p className="text-[11px] text-muted">
                {res.mode === "live"
                  ? `candles ${res.candles?.points ?? 0} • funding ${res.funding?.points ?? 0}`
                  : "mock fixture"}
              </p>
            </Card>

            <Card className="space-y-1">
              <p className="text-xs font-medium text-muted">Ending equity</p>
              <p className="font-mono text-2xl text-foreground">
                {formatMoney(res.result.summary.endingEquity)}
              </p>
              <p className="text-[11px] font-mono text-muted">
                return {formatPct(res.result.summary.totalReturn)}
              </p>
            </Card>

            <Card className="space-y-1">
              <p className="text-xs font-medium text-muted">Trades</p>
              <p className="font-mono text-2xl text-foreground">
                {res.result.summary.tradeCount}
              </p>
              <p className="text-[11px] font-mono text-muted">
                win {formatPct(res.result.summary.winRate)}
              </p>
            </Card>
          </div>

          <EquityCurveChart points={chartPoints} />

          <Card className="p-0">
            <div className="flex items-center justify-between px-6 py-4">
              <div>
                <p className="text-sm font-medium text-foreground">Trades</p>
                <p className="text-xs text-muted">
                  PnL includes funding carry when enabled.
                </p>
              </div>
              <p className="text-xs text-muted">{res.result.trades.length} rows</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-separate border-spacing-0">
                <thead className="text-left text-xs text-muted">
                  <tr>
                    <th className="border-t border-border/60 px-6 py-3 font-medium">Side</th>
                    <th className="border-t border-border/60 px-6 py-3 font-medium">Entry</th>
                    <th className="border-t border-border/60 px-6 py-3 font-medium">Exit</th>
                    <th className="border-t border-border/60 px-6 py-3 font-medium">PnL</th>
                    <th className="border-t border-border/60 px-6 py-3 font-medium">Funding</th>
                    <th className="border-t border-border/60 px-6 py-3 font-medium">Hold</th>
                    <th className="border-t border-border/60 px-6 py-3 font-medium">Reason</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {res.result.trades.length ? (
                    res.result.trades.map((t, i) => {
                      const pnlTone =
                        t.totalPnl > 0 ? "text-success" : t.totalPnl < 0 ? "text-danger" : "text-muted";
                      return (
                        <tr key={i} className="hover:bg-background/40">
                          <td className="border-t border-border/60 px-6 py-3 font-mono text-foreground">
                            {t.side.toUpperCase()}
                          </td>
                          <td className="border-t border-border/60 px-6 py-3 text-muted">
                            <p className="font-mono">{formatTs(t.entryTime)}</p>
                          </td>
                          <td className="border-t border-border/60 px-6 py-3 text-muted">
                            <p className="font-mono">{formatTs(t.exitTime)}</p>
                          </td>
                          <td className={`border-t border-border/60 px-6 py-3 font-mono ${pnlTone}`}>
                            {formatMoney(t.totalPnl)}
                          </td>
                          <td className="border-t border-border/60 px-6 py-3 font-mono text-muted">
                            {formatMoney(t.fundingPnl)}
                          </td>
                          <td className="border-t border-border/60 px-6 py-3 font-mono text-muted">
                            {t.holdSteps}
                          </td>
                          <td className="border-t border-border/60 px-6 py-3 font-mono text-muted">
                            {t.exitReason}
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={7} className="border-t border-border/60 px-6 py-6 text-sm text-muted">
                        No trades.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="border-t border-border/60 px-6 py-4">
              <p className="text-xs text-muted">
                Want to add a new strategy? Implement it in{" "}
                <span className="font-mono text-foreground">src/lib/sim/backtest.ts</span> and wire it
                through <span className="font-mono text-foreground">POST /api/simulate</span>.
              </p>
            </div>
          </Card>
        </section>
      ) : null}
    </main>
  );
}
