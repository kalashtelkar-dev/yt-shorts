import type { Metadata } from "next";
import { CreatePage } from "@/components/create-page";
import { Landing } from "@/components/landing";
import { publicSeller, SiteFooter } from "@/components/legal";
import { env } from "@/config/env";
import { getViewer } from "@/server/session";
import { getSettings } from "@/server/settings";

export const metadata: Metadata = { alternates: { canonical: "/" } };

// People who already use the app land straight on Create; everyone else sees the landing page first
// (its buttons go to /create). With accounts that means signed in; without them, anyone who has made a montage.
export default async function Home() {
  const viewer = await getViewer();
  const knownUser = viewer && (env.AUTH_MODE === "anonymous" || !viewer.isAnonymous);
  if (knownUser) return <CreatePage />;
  // The footer (legal links, business details) lives on the landing page only.
  const { seller } = await getSettings();
  return (
    <>
      <Landing />
      <SiteFooter seller={publicSeller(seller)} payments={env.PAYMENTS_ENABLED} />
    </>
  );
}
