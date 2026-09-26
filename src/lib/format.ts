/** 75_000 → "1:15", 3_725_000 → "1:02:05" */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

// Fixed timezone so server (UTC in containers) and browser render the same text.
const TZ = "Asia/Kolkata";
const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: TZ });
export const formatWhen = (iso: string) => dateFmt.format(new Date(iso));

const timeFmt = new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: TZ });
export const formatTime = (iso: string) => timeFmt.format(new Date(iso));

export const formatCredits = (n: number) => n.toLocaleString("en-IN");

/** 12345 paise → "₹123.45" */
export const formatRupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
