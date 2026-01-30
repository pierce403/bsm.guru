const SQRT_2PI = Math.sqrt(2 * Math.PI);

export function normPdf(x: number) {
  return Math.exp(-0.5 * x * x) / SQRT_2PI;
}

// Abramowitz & Stegun 7.1.26 approximation.
export function normCdf(x: number) {
  if (!Number.isFinite(x)) return x === Infinity ? 1 : 0;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);

  const t = 1 / (1 + 0.2316419 * ax);
  const t2 = t * t;
  const t3 = t2 * t;
  const t4 = t3 * t;
  const t5 = t4 * t;

  const poly =
    0.319381530 * t +
    -0.356563782 * t2 +
    1.781477937 * t3 +
    -1.821255978 * t4 +
    1.330274429 * t5;

  const approx = 1 - normPdf(ax) * poly;
  return sign === 1 ? approx : 1 - approx;
}

