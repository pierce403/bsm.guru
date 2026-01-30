"use client";

import { useEffect, useMemo, useState } from "react";

import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { bsm, bsmPrice, impliedVol, type OptionRight } from "@/lib/quant/bsm";
import { realizedVol } from "@/lib/quant/vol";

type MetaResponse = {
  ts: number;
  meta: { universe: Array<{ name: string; isDelisted?: boolean }> };
};

type MidsResponse = { ts: number; mids: Record<string, string> };

type Candle = { c: string };
type CandlesResponse = { ts: number; candles: Candle[] };

function intervalToSeconds(interval: string) {
  if (interval === "1m") return 60;
  if (interval === "5m") return 5 * 60;
  if (interval === "15m") return 15 * 60;
  if (interval === "1h") return 60 * 60;
  if (interval === "4h") return 4 * 60 * 60;
  if (interval === "1d") return 24 * 60 * 60;
  return null;
}

function formatNum(n: number, digits = 6) {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs === 0) return "0";
  if (abs >= 1000) return n.toFixed(0);
  if (abs >= 100) return n.toFixed(2);
  if (abs >= 1) return n.toFixed(4);
  return n.toFixed(digits);
}

function pickStrikeStep(S: number) {
  if (S >= 50_000) return 500;
  if (S >= 10_000) return 200;
  if (S >= 1_000) return 25;
  if (S >= 100) return 5;
  if (S >= 10) return 0.5;
  return 0.05;
}

function pseudoMisprice(strike: number) {
  // Deterministic, bounded "noise" for demo mode. Range ~[-0.09, +0.09].
  return 0.09 * Math.sin(strike * 0.00073) + 0.03 * Math.sin(strike * 0.017);
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return (await res.json()) as T;
}

export function ScreenerClient() {
  const [universe, setUniverse] = useState<string[]>(["BTC", "ETH", "SOL"]);
  const [coin, setCoin] = useState("BTC");
  const [right, setRight] = useState<OptionRight>("call");

  const [interval, setInterval] = useState("1h");
  const [lookback, setLookback] = useState("14d");

  const [days, setDays] = useState(7);
  const [strike, setStrike] = useState<number | null>(null);
  const [r, setR] = useState(0.0);
  const [q, setQ] = useState(0.0);

  const [volMode, setVolMode] = useState<"hist" | "manual">("hist");
  const [manualVol, setManualVol] = useState(0.7);
  const [marketMidInput, setMarketMidInput] = useState<string>("");

  const [mid, setMid] = useState<number | null>(null);
  const [histVol, setHistVol] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchJson<MetaResponse>("/api/hyperliquid/meta")
      .then((data) => {
        if (cancelled) return;
        const coins = data.meta.universe
          .filter((a) => !a.isDelisted)
          .map((a) => a.name)
          .filter((name) => /^[A-Z0-9]{2,10}$/.test(name)); // hide "@index" style symbols
        setUniverse(coins.length ? coins : ["BTC", "ETH", "SOL"]);
      })
      .catch(() => {
        // Keep defaults; meta isn't required to run.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setErr(null);
      try {
        const mids = await fetchJson<MidsResponse>(
          `/api/hyperliquid/mids?coins=${encodeURIComponent(coin)}`,
          { cache: "no-store" },
        );
        const rawMid = mids.mids[coin];
        const S = rawMid ? Number(rawMid) : NaN;
        if (!Number.isFinite(S)) throw new Error(`No mid for ${coin}`);

        const seconds = intervalToSeconds(interval);
        if (!seconds) throw new Error(`Unsupported interval: ${interval}`);

        const candles = await fetchJson<CandlesResponse>(
          `/api/hyperliquid/candles?coin=${encodeURIComponent(coin)}&interval=${encodeURIComponent(interval)}&lookback=${encodeURIComponent(lookback)}`,
          { cache: "no-store" },
        );
        const closes = candles.candles.map((c) => Number(c.c)).filter(Number.isFinite);
        const sigma = realizedVol({ closes, periodSeconds: seconds });

        if (cancelled) return;
        setMid(S);
        setHistVol(sigma);
        setStrike((prev) => {
          if (prev !== null) return prev;
          const step = pickStrikeStep(S);
          return Math.round(S / step) * step;
        });
      } catch (e) {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : "Failed to load market data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [coin, interval, lookback]);

  const T = useMemo(() => Math.max(days, 0) / 365, [days]);

  const sigma = volMode === "hist" ? histVol : manualVol;

  const fair = useMemo(() => {
    if (!mid || !strike || !sigma) return null;
    try {
      return bsmPrice({ S: mid, K: strike, T, sigma, r, q }, right);
    } catch {
      return null;
    }
  }, [mid, strike, sigma, T, r, q, right]);

  const marketMid = useMemo(() => {
    const v = Number(marketMidInput);
    if (marketMidInput.trim() !== "" && Number.isFinite(v) && v >= 0) return v;
    if (fair === null) return null;
    if (!strike) return null;
    return fair * (1 + pseudoMisprice(strike));
  }, [marketMidInput, fair, strike]);

  const model = useMemo(() => {
    if (!mid || !strike || !sigma) return null;
    try {
      return bsm({ S: mid, K: strike, T, sigma, r, q }, right);
    } catch {
      return null;
    }
  }, [mid, strike, sigma, T, r, q, right]);

  const edge = useMemo(() => {
    if (marketMid === null || fair === null) return null;
    return marketMid - fair;
  }, [marketMid, fair]);

  const iv = useMemo(() => {
    if (!mid || !strike || marketMid === null) return null;
    return impliedVol({ S: mid, K: strike, T, r, q, right, price: marketMid });
  }, [mid, strike, marketMid, T, r, q, right]);

  const chain = useMemo(() => {
    if (!mid || !sigma) return [];
    const step = pickStrikeStep(mid);
    const center = Math.round(mid / step) * step;
    const strikes = Array.from({ length: 13 }, (_, i) => center + (i - 6) * step);
    const rows = strikes
      .filter((K) => K > 0)
      .map((K) => {
        const fairK = bsmPrice({ S: mid, K, T, sigma, r, q }, right);
        const marketK = fairK * (1 + pseudoMisprice(K));
        const ivK = impliedVol({ S: mid, K, T, r, q, right, price: marketK });
        return {
          K,
          fair: fairK,
          market: marketK,
          edge: marketK - fairK,
          edgePct: fairK === 0 ? null : (marketK / fairK - 1) * 100,
          iv: ivK,
        };
      })
      .sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));

    return rows;
  }, [mid, sigma, T, r, q, right]);

  return (
    <main className="space-y-6">
      <header className="space-y-3">
        <h1 className="font-display text-4xl tracking-tight text-foreground">
          Screener
        </h1>
        <p className="max-w-2xl text-base leading-7 text-muted">
          Live underlying prices and historical volatility from Hyperliquid,
          plus BSM fair value, implied vol, and greeks. Option quotes are
          currently simulated (until we wire a real options venue).
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-12">
        <Card className="space-y-5 lg:col-span-5">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-foreground">Inputs</p>
            <p className="text-xs text-muted">{loading ? "Loading..." : "Ready"}</p>
          </div>

          {err ? (
            <div className="rounded-2xl bg-background/60 p-4 text-sm text-danger ring-1 ring-border/80">
              {err}
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted">Underlying</label>
              <Select value={coin} onChange={(e) => setCoin(e.target.value)}>
                {universe.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted">Right</label>
              <Select
                value={right}
                onChange={(e) => setRight(e.target.value as OptionRight)}
              >
                <option value="call">Call</option>
                <option value="put">Put</option>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted">Days (T)</label>
              <Input
                inputMode="numeric"
                type="number"
                min={0}
                step={1}
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted">Strike (K)</label>
              <Input
                inputMode="decimal"
                type="number"
                min={0}
                step="any"
                value={strike ?? ""}
                onChange={(e) =>
                  setStrike(e.target.value === "" ? null : Number(e.target.value))
                }
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted">
                Risk-free (r)
              </label>
              <Input
                inputMode="decimal"
                type="number"
                step="any"
                value={r}
                onChange={(e) => setR(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted">Yield (q)</label>
              <Input
                inputMode="decimal"
                type="number"
                step="any"
                value={q}
                onChange={(e) => setQ(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted">Vol mode</label>
              <Select
                value={volMode}
                onChange={(e) => setVolMode(e.target.value as "hist" | "manual")}
              >
                <option value="hist">Historical</option>
                <option value="manual">Manual</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted">
                {volMode === "hist" ? "Lookback" : "σ (manual)"}
              </label>
              {volMode === "hist" ? (
                <div className="grid grid-cols-2 gap-2">
                  <Select
                    value={interval}
                    onChange={(e) => setInterval(e.target.value)}
                  >
                    <option value="1h">1h</option>
                    <option value="4h">4h</option>
                    <option value="1d">1d</option>
                  </Select>
                  <Select
                    value={lookback}
                    onChange={(e) => setLookback(e.target.value)}
                  >
                    <option value="7d">7d</option>
                    <option value="14d">14d</option>
                    <option value="30d">30d</option>
                    <option value="90d">90d</option>
                  </Select>
                </div>
              ) : (
                <Input
                  inputMode="decimal"
                  type="number"
                  step="any"
                  min={0}
                  value={manualVol}
                  onChange={(e) => setManualVol(Number(e.target.value))}
                />
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted">
              Market mid (optional)
            </label>
            <Input
              inputMode="decimal"
              type="number"
              min={0}
              step="any"
              placeholder="Leave blank to use simulated quotes"
              value={marketMidInput}
              onChange={(e) => setMarketMidInput(e.target.value)}
            />
          </div>
        </Card>

        <Card className="space-y-5 lg:col-span-7">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-foreground">Snapshot</p>
            <p className="text-xs text-muted">
              {volMode === "hist" ? "Historical σ" : "Manual σ"}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl bg-background/60 p-4 ring-1 ring-border/80">
              <p className="text-xs font-medium text-muted">S</p>
              <p className="mt-1 font-mono text-lg text-foreground">
                {mid ? formatNum(mid, 2) : "—"}
              </p>
            </div>
            <div className="rounded-2xl bg-background/60 p-4 ring-1 ring-border/80">
              <p className="text-xs font-medium text-muted">σ</p>
              <p className="mt-1 font-mono text-lg text-foreground">
                {sigma ? `${(sigma * 100).toFixed(1)}%` : "—"}
              </p>
              {volMode === "hist" ? (
                <p className="mt-1 text-xs text-muted">
                  {histVol ? "annualized realized vol" : "not enough data"}
                </p>
              ) : null}
            </div>
            <div className="rounded-2xl bg-background/60 p-4 ring-1 ring-border/80">
              <p className="text-xs font-medium text-muted">T</p>
              <p className="mt-1 font-mono text-lg text-foreground">
                {days}d
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl bg-background/60 p-4 ring-1 ring-border/80">
              <p className="text-xs font-medium text-muted">Fair (BSM)</p>
              <p className="mt-1 font-mono text-lg text-foreground">
                {fair === null ? "—" : formatNum(fair)}
              </p>
            </div>
            <div className="rounded-2xl bg-background/60 p-4 ring-1 ring-border/80">
              <p className="text-xs font-medium text-muted">Market</p>
              <p className="mt-1 font-mono text-lg text-foreground">
                {marketMid === null ? "—" : formatNum(marketMid)}
              </p>
              {marketMidInput.trim() === "" ? (
                <p className="mt-1 text-xs text-muted">simulated</p>
              ) : null}
            </div>
            <div className="rounded-2xl bg-background/60 p-4 ring-1 ring-border/80">
              <p className="text-xs font-medium text-muted">Edge</p>
              <p
                className={[
                  "mt-1 font-mono text-lg",
                  edge === null
                    ? "text-foreground"
                    : edge > 0
                      ? "text-danger"
                      : "text-success",
                ].join(" ")}
              >
                {edge === null ? "—" : formatNum(edge)}
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl bg-background/60 p-4 ring-1 ring-border/80">
              <p className="text-xs font-medium text-muted">Implied vol</p>
              <p className="mt-1 font-mono text-lg text-foreground">
                {iv === null ? "—" : `${(iv * 100).toFixed(1)}%`}
              </p>
            </div>
            <div className="rounded-2xl bg-background/60 p-4 ring-1 ring-border/80">
              <p className="text-xs font-medium text-muted">Greeks</p>
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-muted">
                <p>
                  Δ <span className="font-mono text-foreground">{model ? formatNum(model.delta, 4) : "—"}</span>
                </p>
                <p>
                  Γ <span className="font-mono text-foreground">{model ? formatNum(model.gamma, 6) : "—"}</span>
                </p>
                <p>
                  ν <span className="font-mono text-foreground">{model ? formatNum(model.vega, 4) : "—"}</span>
                </p>
                <p>
                  θ <span className="font-mono text-foreground">{model ? formatNum(model.theta, 4) : "—"}</span>
                </p>
                <p>
                  ρ <span className="font-mono text-foreground">{model ? formatNum(model.rho, 4) : "—"}</span>
                </p>
              </div>
            </div>
          </div>
        </Card>
      </div>

      <Card className="p-0">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <p className="text-sm font-medium text-foreground">Demo chain</p>
            <p className="text-xs text-muted">
              Sorted by |edge| (simulated market vs BSM fair).
            </p>
          </div>
          <p className="text-xs text-muted">
            {coin} {right.toUpperCase()}
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="border-t border-border/60 px-6 py-3 font-medium">
                  K
                </th>
                <th className="border-t border-border/60 px-6 py-3 font-medium">
                  Fair
                </th>
                <th className="border-t border-border/60 px-6 py-3 font-medium">
                  Market
                </th>
                <th className="border-t border-border/60 px-6 py-3 font-medium">
                  Edge
                </th>
                <th className="border-t border-border/60 px-6 py-3 font-medium">
                  Edge %
                </th>
                <th className="border-t border-border/60 px-6 py-3 font-medium">
                  IV
                </th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {chain.map((row) => (
                <tr key={row.K} className="hover:bg-background/40">
                  <td className="border-t border-border/60 px-6 py-3 font-mono text-foreground">
                    {formatNum(row.K, 2)}
                  </td>
                  <td className="border-t border-border/60 px-6 py-3 font-mono text-foreground">
                    {formatNum(row.fair)}
                  </td>
                  <td className="border-t border-border/60 px-6 py-3 font-mono text-foreground">
                    {formatNum(row.market)}
                  </td>
                  <td
                    className={[
                      "border-t border-border/60 px-6 py-3 font-mono",
                      row.edge > 0 ? "text-danger" : "text-success",
                    ].join(" ")}
                  >
                    {formatNum(row.edge)}
                  </td>
                  <td className="border-t border-border/60 px-6 py-3 font-mono text-muted">
                    {row.edgePct === null ? "—" : `${row.edgePct.toFixed(1)}%`}
                  </td>
                  <td className="border-t border-border/60 px-6 py-3 font-mono text-muted">
                    {row.iv === null ? "—" : `${(row.iv * 100).toFixed(1)}%`}
                  </td>
                </tr>
              ))}
              {chain.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="border-t border-border/60 px-6 py-6 text-sm text-muted"
                  >
                    Waiting on market data…
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

