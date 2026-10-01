import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import localFont from "next/font/local";
import { brand } from "@/config/brand";
import { env } from "@/config/env";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"], display: "swap" });
// Castle Chunk (Decograph Studio, 1001Fonts free commercial licence in src/fonts): display only, see `font-display`.
const castle = localFont({ src: "../fonts/CastleChunk-Regular.woff2", variable: "--font-castle", display: "swap" });

// Search and link previews. opengraph-image.jpg (next to this file) is the share image for every page.
export const metadata: Metadata = {
  metadataBase: new URL(env.APP_URL),
  title: { default: brand.seoTitle, template: `%s · ${brand.name}` },
  description: brand.seoDescription,
  applicationName: brand.name,
  keywords: ["gameplay montage", "kill montage maker", "AI video editor", "YouTube Shorts", "Instagram Reels", "TikTok", "vertical video", "Valorant montage", "CS2 montage", "BGMI montage"],
  openGraph: { type: "website", siteName: brand.name, title: brand.seoTitle, description: brand.seoDescription, locale: "en_IN" },
  twitter: { card: "summary_large_image", title: brand.seoTitle, description: brand.seoDescription },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`dark ${inter.variable} ${geistMono.variable} ${castle.variable}`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
