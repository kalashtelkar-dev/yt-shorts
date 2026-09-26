/**
 * One key per real inbox: "Me+x@gmail.com" and "m.e@googlemail.com" both become "me@gmail.com".
 * Used to give starter credits once per inbox, not once per address variant.
 */
export function inboxKey(email: string): string {
  const [local = "", domain = ""] = email.trim().toLowerCase().split("@");
  const base = local.split("+")[0];
  return domain === "gmail.com" || domain === "googlemail.com" ? `${base.replaceAll(".", "")}@gmail.com` : `${base}@${domain}`;
}
