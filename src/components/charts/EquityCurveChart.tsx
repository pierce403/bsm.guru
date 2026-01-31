type Point = { time: number; equity: number };

function clamp(n: number, lo: number, hi: number) {
  return Math.min(Math.max(n, lo), hi);
}

function fmtMoney(n: number) {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

export function EquityCurveChart(props: { points: Point[]; height?: number }) {
  const h = props.height ?? 200;
  const w = 800; // viewBox width; responsive via CSS

  const pts = props.points.filter((p) => Number.isFinite(p.time) && Number.isFinite(p.equity));
  if (pts.length < 2) {
    return (
      <div className="grid h-[200px] place-items-center rounded-3xl bg-background/60 ring-1 ring-border/80">
        <p className="text-sm text-muted">No equity curve yet.</p>
      </div>
    );
  }

  let minX = pts[0]!.time;
  let maxX = pts[pts.length - 1]!.time;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.time < minX) minX = p.time;
    if (p.time > maxX) maxX = p.time;
    if (p.equity < minY) minY = p.equity;
    if (p.equity > maxY) maxY = p.equity;
  }

  const pad = (maxY - minY) * 0.08;
  const y0 = minY - pad;
  const y1 = maxY + pad;
  const dx = Math.max(1, maxX - minX);
  const dy = Math.max(1e-9, y1 - y0);

  const x = (t: number) => ((t - minX) / dx) * w;
  const y = (v: number) => h - ((v - y0) / dy) * h;

  const d = pts
    .map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.time).toFixed(2)} ${y(p.equity).toFixed(2)}`)
    .join(" ");

  const area = `${d} L ${x(maxX).toFixed(2)} ${h} L ${x(minX).toFixed(2)} ${h} Z`;

  const last = pts[pts.length - 1]!;

  return (
    <div className="rounded-3xl bg-background/60 p-4 ring-1 ring-border/80">
      <div className="flex items-end justify-between gap-6">
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted">Equity curve</p>
          <p className="font-mono text-sm text-foreground">{fmtMoney(last.equity)}</p>
        </div>
        <div className="text-right text-[11px] text-muted">
          <p>min {fmtMoney(minY)}</p>
          <p>max {fmtMoney(maxY)}</p>
        </div>
      </div>

      <svg
        className="mt-3 h-[200px] w-full"
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Equity curve chart"
      >
        <defs>
          <linearGradient id="bsmEquityFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="rgba(164,244,207,0.30)" />
            <stop offset="1" stopColor="rgba(164,244,207,0.00)" />
          </linearGradient>
          <linearGradient id="bsmEquityStroke" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="rgba(115,182,255,0.90)" />
            <stop offset="1" stopColor="rgba(164,244,207,0.95)" />
          </linearGradient>
        </defs>

        {/* subtle horizontal grid */}
        {[0.2, 0.4, 0.6, 0.8].map((t) => (
          <line
            key={t}
            x1={0}
            x2={w}
            y1={clamp(h * t, 0, h)}
            y2={clamp(h * t, 0, h)}
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={1}
          />
        ))}

        <path d={area} fill="url(#bsmEquityFill)" />
        <path d={d} fill="none" stroke="url(#bsmEquityStroke)" strokeWidth={2.5} />

        {/* end marker */}
        <circle cx={x(last.time)} cy={y(last.equity)} r={5} fill="rgba(164,244,207,0.95)" />
        <circle cx={x(last.time)} cy={y(last.equity)} r={9} fill="rgba(164,244,207,0.14)" />
      </svg>
    </div>
  );
}

