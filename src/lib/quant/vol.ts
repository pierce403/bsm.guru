export type RealizedVolParams = {
  closes: number[];
  periodSeconds: number;
  yearSeconds?: number;
};

export function realizedVol({
  closes,
  periodSeconds,
  yearSeconds = 365 * 24 * 60 * 60,
}: RealizedVolParams) {
  if (!Array.isArray(closes) || closes.length < 2) return null;
  if (!Number.isFinite(periodSeconds) || periodSeconds <= 0) return null;

  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const p0 = closes[i - 1];
    const p1 = closes[i];
    if (!Number.isFinite(p0) || !Number.isFinite(p1) || p0 <= 0 || p1 <= 0)
      continue;
    rets.push(Math.log(p1 / p0));
  }
  if (rets.length < 2) return null;

  let mean = 0;
  for (const r of rets) mean += r;
  mean /= rets.length;

  let ss = 0;
  for (const r of rets) ss += (r - mean) * (r - mean);
  const variance = ss / (rets.length - 1);
  const perPeriod = Math.sqrt(variance);

  const annualFactor = Math.sqrt(yearSeconds / periodSeconds);
  return perPeriod * annualFactor;
}

