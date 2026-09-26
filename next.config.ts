import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Tree-shake icon imports so each page ships only the icons it uses.
  experimental: { optimizePackageImports: ["lucide-react"] },
};

export default nextConfig;
