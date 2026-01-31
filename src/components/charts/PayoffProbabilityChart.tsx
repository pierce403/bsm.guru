import { normPdf } from "@/lib/quant/normal";

type Position = "long" | "short";

export type PayoffProbabilityChartProps = {
  spot: number;
  sigma: number; // annualized
  horizonDays: number;
  position: Position;
  width?: number;
  height?: number;
};

type Pt = {
  x: number;
  pdf: number;
  payoff: number;
  dens: number;
};

function lognormalPdf(x: number, mu: number, s: number) {
  if (x <= 0) return 0;
  const z = (Math.log(x) - mu) / s;
  return normPdf(z) / (x * s);
}

function pathFromPoints(points: Array<{ x: number; y: number }>) {
  if (points.length === 0) return "";
  let d = `M ${points[0]!.x.toFixed(2)} ${points[0]!.y.toFixed(2)}`;
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!;
    d += ` L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
  }
  return d;
}

function segmentsBySign(
  pts: Pt[],
  value: (p: Pt) => number,
  sign: 1 | -1,
) {
  const out: Pt[][] = [];
  let current: Pt[] = [];

  const isOn = (p: Pt) => (sign === 1 ? value(p) > 0 : value(p) < 0);

  for (const p of pts) {
    if (isOn(p)) {
      current.push(p);
      continue;
    }
    if (current.length) {
      out.push(current);
      current = [];
    }
  }
  if (current.length) out.push(current);
  return out;
}

export function PayoffProbabilityChart({
  spot,
  sigma,
  horizonDays,
  position,
  width = 760,
  height = 260,
}: PayoffProbabilityChartProps) {
  const pad = { l: 46, r: 16, t: 18, b: 28 };
  const baseY = Math.floor(height * 0.62);
  const pdfH = baseY - pad.t;
  const densH = Math.max(height - pad.b - baseY, 46);

  const T = Math.max(horizonDays, 0) / 365;
  const sRaw = sigma * Math.sqrt(Math.max(T, 0));
  const s = Math.max(sRaw, 1e-6);

  // Choose mu so that E[ST] == spot (for a lognormal with log-stddev s).
  // This is a neutral "no-drift" model for visualization.
  const mu = Math.log(Math.max(spot, 1e-12)) - 0.5 * s * s;

  const k = position === "long" ? 1 : -1;

  // Use +-4σ in log space as a visually stable domain.
  const lnMin = Math.log(spot) - 4 * s;
  const lnMax = Math.log(spot) + 4 * s;

  const N = 220;
  const pts: Pt[] = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const ln = lnMin + t * (lnMax - lnMin);
    const x = Math.exp(ln);
    const pdf = lognormalPdf(x, mu, s);
    const payoff = k * (x - spot);
    const dens = payoff * pdf;
    pts.push({ x, pdf, payoff, dens });
  }

  const pdfMax = Math.max(...pts.map((p) => p.pdf), 1e-12);
  const densMaxAbs = Math.max(...pts.map((p) => Math.abs(p.dens)), 1e-12);
  const payoffMaxAbs = Math.max(...pts.map((p) => Math.abs(p.payoff)), 1e-12);

  const xToSvg = (x: number) => {
    const ln = Math.log(x);
    const u = (ln - lnMin) / (lnMax - lnMin);
    return pad.l + u * (width - pad.l - pad.r);
  };

  const yPdf = (pdf: number) => baseY - (pdf / pdfMax) * pdfH;

  const yDens = (dens: number) =>
    baseY - (dens / densMaxAbs) * densH;

  const yPayoff = (payoff: number) =>
    baseY - (payoff / payoffMaxAbs) * densH;

  const pdfPath = pathFromPoints(pts.map((p) => ({ x: xToSvg(p.x), y: yPdf(p.pdf) })));
  const payoffPath = pathFromPoints(
    pts.map((p) => ({ x: xToSvg(p.x), y: yPayoff(p.payoff) })),
  );

  const posSegs = segmentsBySign(pts, (p) => p.dens, 1);
  const negSegs = segmentsBySign(pts, (p) => p.dens, -1);

  const areaPath = (seg: Pt[]) => {
    if (seg.length < 2) return "";
    const top = seg.map((p) => ({ x: xToSvg(p.x), y: yDens(p.dens) }));
    const firstX = xToSvg(seg[0]!.x);
    const lastX = xToSvg(seg[seg.length - 1]!.x);
    const dTop = pathFromPoints(top);
    return `${dTop} L ${lastX.toFixed(2)} ${baseY.toFixed(2)} L ${firstX.toFixed(2)} ${baseY.toFixed(2)} Z`;
  };

  const xSpot = xToSvg(spot);
  const footer = `${horizonDays}d horizon • ${position.toUpperCase()} (linear payoff vs end price) • spot ${spot.toFixed(2)} • σ ${(sigma * 100).toFixed(1)}%/yr`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-auto w-full"
      role="img"
      aria-label="Model-based probability-weighted payoff chart"
    >
      <defs>
        <linearGradient id="bsm_pdf_stroke" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="color-mix(in oklab, var(--fg) 65%, transparent)" />
          <stop offset="1" stopColor="color-mix(in oklab, var(--fg) 85%, transparent)" />
        </linearGradient>
      </defs>

      {/* Axis */}
      <line
        x1={pad.l}
        x2={width - pad.r}
        y1={baseY}
        y2={baseY}
        stroke="color-mix(in oklab, var(--border) 85%, transparent)"
        strokeWidth="1"
      />

      {/* Density areas */}
      {negSegs.map((seg, i) => (
        <path
          key={`neg-${i}`}
          d={areaPath(seg)}
          fill="color-mix(in oklab, var(--danger) 32%, transparent)"
          stroke="color-mix(in oklab, var(--danger) 35%, transparent)"
          strokeWidth="1"
        />
      ))}
      {posSegs.map((seg, i) => (
        <path
          key={`pos-${i}`}
          d={areaPath(seg)}
          fill="color-mix(in oklab, var(--success) 32%, transparent)"
          stroke="color-mix(in oklab, var(--success) 35%, transparent)"
          strokeWidth="1"
        />
      ))}

      {/* Payoff line */}
      <path
        d={payoffPath}
        fill="none"
        stroke="color-mix(in oklab, var(--fg) 55%, transparent)"
        strokeWidth="1.5"
        strokeDasharray="3 6"
      />

      {/* PDF curve */}
      <path
        d={pdfPath}
        fill="none"
        stroke="url(#bsm_pdf_stroke)"
        strokeWidth="2.2"
      />

      {/* Spot marker */}
      <line
        x1={xSpot}
        x2={xSpot}
        y1={pad.t}
        y2={baseY + densH}
        stroke="color-mix(in oklab, var(--border) 75%, transparent)"
        strokeWidth="1"
        strokeDasharray="2 6"
      />

      {/* Labels */}
      <text
        x={pad.l}
        y={height - 8}
        fontSize="11"
        fill="color-mix(in oklab, var(--muted) 85%, transparent)"
      >
        {footer}
      </text>
    </svg>
  );
}
