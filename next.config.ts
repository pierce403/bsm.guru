import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

function resolveDistDir() {
  const raw = process.env.BSM_NEXT_DIST_DIR?.trim();
  if (!raw) return undefined;
  // Turbopack currently requires distDir to stay within the project root.
  // Keep this strict so builds/tests don't panic.
  if (path.isAbsolute(raw)) return undefined;
  if (raw.includes("..")) return undefined;
  return raw;
}

const nextConfig: NextConfig = {
  distDir: resolveDistDir(),
  turbopack: {
    // Avoid Next inferring a too-wide workspace root (and pulling in stray lockfiles/types).
    root: projectRoot,
  },
};

export default nextConfig;
