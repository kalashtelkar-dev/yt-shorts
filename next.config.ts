import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Tree-shake icon imports so each page ships only the icons it uses.
  experimental: { optimizePackageImports: ["lucide-react"] },
  // YouTube's stills for the job page's "Made from" (src/lib/youtube.ts): fetched by our image optimizer from this one
  // host and path, so the browser makes no third-party request (CLAUDE.md §8.1).
  images: { remotePatterns: [{ protocol: "https", hostname: "i.ytimg.com", pathname: "/vi/**" }] },
};

export default nextConfig;
