export function parseDurationMs(input: string) {
  const raw = input.trim().toLowerCase();
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/.exec(raw);
  if (!match) return null;

  const n = Number(match[1]);
  if (!Number.isFinite(n) || n < 0) return null;

  const unit = match[2];
  const mult =
    unit === "ms"
      ? 1
      : unit === "s"
        ? 1000
        : unit === "m"
          ? 60_000
          : unit === "h"
            ? 3_600_000
            : 86_400_000;

  return Math.round(n * mult);
}

