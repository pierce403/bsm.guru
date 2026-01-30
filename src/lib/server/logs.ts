import "server-only";

import fs from "node:fs/promises";
import path from "node:path";

export type LogLine = Record<string, unknown>;

function logDir() {
  const raw = process.env.BSM_LOG_DIR ?? path.join(process.cwd(), "logs");
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

async function appendJsonLine(file: string, line: LogLine) {
  const dir = logDir();
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });

  const full = path.join(dir, file);
  const payload = `${JSON.stringify(line)}\n`;
  await fs.appendFile(full, payload, { encoding: "utf8" });
}

function clientIp(req: Request) {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0]?.trim() || null;
  return req.headers.get("x-real-ip") ?? null;
}

export async function logWalletEvent(req: Request, line: LogLine) {
  const meta: LogLine = {
    ts: Date.now(),
    host: req.headers.get("host"),
    ip: clientIp(req),
    ua: req.headers.get("user-agent"),
    ...line,
  };

  try {
    await appendJsonLine("wallet.log", meta);
  } catch {
    // Logging must never break core functionality.
  }
}

