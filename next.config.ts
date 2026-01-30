import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    // Avoid Next inferring a too-wide workspace root (and pulling in stray lockfiles/types).
    root: projectRoot,
  },
};

export default nextConfig;
