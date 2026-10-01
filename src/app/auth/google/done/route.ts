import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "@/config/env";
import { clientIp } from "@/server/ip";
import { getViewer, welcomeCredits } from "@/server/session";

// Where Google sign-in ends: new accounts get their starter credits (same rules as email sign-in), then home.
export async function GET() {
  const user = await getViewer();
  if (!user || user.isAnonymous) redirect("/sign-in?google=failed");
  await welcomeCredits(user, clientIp(await headers(), env.TRUSTED_PROXY_HOPS));
  redirect("/");
}
