import type { MetadataRoute } from "next";
import { env } from "@/config/env";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: env.APP_URL, changeFrequency: "weekly", priority: 1 },
    { url: `${env.APP_URL}/create`, changeFrequency: "monthly", priority: 0.8 },
    ...["/terms", "/privacy", "/refunds", "/contact"].map((p) => ({ url: `${env.APP_URL}${p}`, changeFrequency: "yearly" as const, priority: 0.3 })),
  ];
}
