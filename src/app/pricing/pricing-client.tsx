"use client";

import { useMemo, useState } from "react";

import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { bsm, bsmPrice, impliedVol } from "@/lib/quant/bsm";

function formatNum(n: number, digits = 6) {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs === 0) return "0";
  if (abs >= 1000) return n.toFixed(0);
  if (abs >= 100) return n.toFixed(2);
  if (abs >= 1) return n.toFixed(4);
  return n.toFixed(digits);
}

export function PricingClient() {
  const [S, setS] = useState(100);
  const [K, setK] = useState(100);
  const [days, setDays] = useState(30);
  const [sigma, setSigma] = useState(0.6);
  const [r, setR] = useState(0.0);
  const [q, setQ] = useState(0.0);

  const [marketCall, setMarketCall] = useState<string>("");
  const [marketPut, setMarketPut] = useState<string>("");

  const T = useMemo(() => Math.max(days, 0) / 365, [days]);

  const call = useMemo(() => {
    try {
      return bsm({ S, K, T, sigma, r, q }, "call");
    } catch {
      return null;
    }
  }, [S, K, T, sigma, r, q]);

  const put = useMemo(() => {
    try {
      return bsm({ S, K, T, sigma, r, q }, "put");
    } catch {
      return null;
    }
  }, [S, K, T, sigma, r, q]);

  const ivCall = useMemo(() => {
    const p = Number(marketCall);
    if (marketCall.trim() === "" || !Number.isFinite(p) || p < 0) return null;
    return impliedVol({ S, K, T, r, q, right: "call", price: p });
  }, [marketCall, S, K, T, r, q]);

  const ivPut = useMemo(() => {
    const p = Number(marketPut);
    if (marketPut.trim() === "" || !Number.isFinite(p) || p < 0) return null;
    return impliedVol({ S, K, T, r, q, right: "put", price: p });
  }, [marketPut, S, K, T, r, q]);

  const parity = useMemo(() => {
    try {
      const callPx = bsmPrice({ S, K, T, sigma, r, q }, "call");
      const putPx = bsmPrice({ S, K, T, sigma, r, q }, "put");
      const rhs = S * Math.exp(-q * T) - K * Math.exp(-r * T);
      return { lhs: callPx - putPx, rhs };
    } catch {
      return null;
    }
  }, [S, K, T, sigma, r, q]);

  return (
    <main className="space-y-6">
      <header className="space-y-3">
        <h1 className="font-display text-4xl tracking-tight text-foreground">
          Pricing Sandbox
        </h1>
        <p className="max-w-2xl text-base leading-7 text-muted">
          A simple Black-Scholes-Merton calculator (prices + greeks) plus implied
          volatility inversion.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-12">
        <Card className="space-y-5 lg:col-span-5">
          <p className="text-sm font-medium text-foreground">Inputs</p>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted">S</label>
              <Input
                type="number"
                inputMode="decimal"
                step="any"
                min={0}
                value={S}
                onChange={(e) => setS(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted">K</label>
              <Input
                type="number"
                inputMode="decimal"
                step="any"
                min={0}
                value={K}
                onChange={(e) => setK(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted">Days (T)</label>
              <Input
                type="number"
                inputMode="numeric"
                step={1}
                min={0}
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted">σ</label>
              <Input
                type="number"
                inputMode="decimal"
                step="any"
                min={0}
                value={sigma}
                onChange={(e) => setSigma(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted">r</label>
              <Input
                type="number"
                inputMode="decimal"
                step="any"
                value={r}
                onChange={(e) => setR(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted">q</label>
              <Input
                type="number"
                inputMode="decimal"
                step="any"
                value={q}
                onChange={(e) => setQ(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted">
                Market call (optional)
              </label>
              <Input
                type="number"
                inputMode="decimal"
                step="any"
                min={0}
                value={marketCall}
                onChange={(e) => setMarketCall(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted">
                Market put (optional)
              </label>
              <Input
                type="number"
                inputMode="decimal"
                step="any"
                min={0}
                value={marketPut}
                onChange={(e) => setMarketPut(e.target.value)}
              />
            </div>
          </div>
        </Card>

        <Card className="space-y-5 lg:col-span-7">
          <p className="text-sm font-medium text-foreground">Outputs</p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl bg-background/60 p-4 ring-1 ring-border/80">
              <p className="text-xs font-medium text-muted">Call</p>
              <p className="mt-1 font-mono text-lg text-foreground">
                {call ? formatNum(call.price) : "—"}
              </p>
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-muted">
                <p>
                  Δ <span className="font-mono text-foreground">{call ? formatNum(call.delta, 4) : "—"}</span>
                </p>
                <p>
                  Γ <span className="font-mono text-foreground">{call ? formatNum(call.gamma, 6) : "—"}</span>
                </p>
                <p>
                  ν <span className="font-mono text-foreground">{call ? formatNum(call.vega, 4) : "—"}</span>
                </p>
                <p>
                  θ <span className="font-mono text-foreground">{call ? formatNum(call.theta, 4) : "—"}</span>
                </p>
                <p>
                  ρ <span className="font-mono text-foreground">{call ? formatNum(call.rho, 4) : "—"}</span>
                </p>
              </div>
              <p className="mt-2 text-xs text-muted">
                IV: {ivCall === null ? "—" : `${(ivCall * 100).toFixed(1)}%`}
              </p>
            </div>

            <div className="rounded-2xl bg-background/60 p-4 ring-1 ring-border/80">
              <p className="text-xs font-medium text-muted">Put</p>
              <p className="mt-1 font-mono text-lg text-foreground">
                {put ? formatNum(put.price) : "—"}
              </p>
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-muted">
                <p>
                  Δ <span className="font-mono text-foreground">{put ? formatNum(put.delta, 4) : "—"}</span>
                </p>
                <p>
                  Γ <span className="font-mono text-foreground">{put ? formatNum(put.gamma, 6) : "—"}</span>
                </p>
                <p>
                  ν <span className="font-mono text-foreground">{put ? formatNum(put.vega, 4) : "—"}</span>
                </p>
                <p>
                  θ <span className="font-mono text-foreground">{put ? formatNum(put.theta, 4) : "—"}</span>
                </p>
                <p>
                  ρ <span className="font-mono text-foreground">{put ? formatNum(put.rho, 4) : "—"}</span>
                </p>
              </div>
              <p className="mt-2 text-xs text-muted">
                IV: {ivPut === null ? "—" : `${(ivPut * 100).toFixed(1)}%`}
              </p>
            </div>
          </div>

          <div className="rounded-2xl bg-background/60 p-4 ring-1 ring-border/80">
            <p className="text-xs font-medium text-muted">Call-put parity</p>
            <p className="mt-1 font-mono text-sm text-foreground">
              {parity
                ? `${formatNum(parity.lhs)}  ≈  ${formatNum(parity.rhs)}`
                : "—"}
            </p>
          </div>
        </Card>
      </div>
    </main>
  );
}

