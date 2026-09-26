import "server-only";

/**
 * Client IP for rate limits. X-Forwarded-For entries on the left are whatever the client sent;
 * each trusted proxy appends the address it saw. So count `trustedHops` entries from the right
 * (1 = one ingress/load balancer in front of the app). Never trust X-Real-IP, which a proxy may pass through.
 */
export function clientIp(h: Headers, trustedHops: number): string {
  const chain = (h.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (trustedHops < 1 || chain.length < trustedHops) return "unknown";
  return chain[chain.length - trustedHops];
}
