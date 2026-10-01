import type { Metadata } from "next";
import { CreatePage } from "@/components/create-page";

export const metadata: Metadata = {
  title: "Make a montage",
  description: "Paste a gameplay link or upload a match, pick a style and a song, and get a vertical kill montage for Shorts, Reels and TikTok.",
  alternates: { canonical: "/create" },
};

export default CreatePage;
