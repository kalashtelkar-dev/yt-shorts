import type { MetadataRoute } from "next";
import { env } from "@/config/env";

// Only the public pages are crawlable; accounts, montages, admin and the API stay out of search.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/api/", "/account", "/library", "/jobs/", "/auth/", "/verify", "/forgot-password"] },
    sitemap: `${env.APP_URL}/sitemap.xml`,
  };
}
