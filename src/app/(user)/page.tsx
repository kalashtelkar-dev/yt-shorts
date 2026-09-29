import { CreatePage } from "@/components/create-page";
import { Landing } from "@/components/landing";
import { env } from "@/config/env";
import { getViewer } from "@/server/session";

// People who already use the app land straight on Create; everyone else sees the landing page first
// (its buttons go to /create). With accounts that means signed in; without them, anyone who has made a montage.
export default async function Home() {
  const viewer = await getViewer();
  const knownUser = viewer && (env.AUTH_MODE === "anonymous" || !viewer.isAnonymous);
  return knownUser ? <CreatePage /> : <Landing />;
}
