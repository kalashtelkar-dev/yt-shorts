// Money math shared by server and client: credits, GST and invoice numbers. All amounts are integer paise.

/** 1 credit = 1 second of editing, rounded up. */
export const creditsForRun = (runMs: number) => Math.max(0, Math.ceil(runMs / 1000));

/** Credits a payment buys at the price per credit (GST included). */
export const creditsForPaise = (amountPaise: number, sellPaisePerCredit: number) => (sellPaisePerCredit > 0 ? Math.floor(amountPaise / sellPaisePerCredit) : 0);

/** The amounts the purchase wheel offers (whole rupees), within the admin's limits. */
const WHEEL_RUPEES = [100, 150, 200, 250, 300, 400, 500, 750, 1000, 1500, 2000, 2500, 3000, 4000, 5000];
export function purchaseAmounts(minPaise: number, maxPaise: number): number[] {
  const list = WHEEL_RUPEES.filter((r) => r * 100 >= minPaise && r * 100 <= maxPaise);
  const min = Math.ceil(minPaise / 100);
  return list.length && list[0] === min ? list : [min, ...list];
}

export type GstSplit = { taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number; totalPaise: number };

/**
 * Splits a GST-inclusive total. Same state as the seller: CGST + SGST (half each); another state: IGST.
 * The tax is total − taxable, so the parts always add up to exactly what was paid.
 */
export function splitGst(totalPaise: number, rateBps: number, intraState: boolean): GstSplit {
  const taxablePaise = Math.round((totalPaise * 10_000) / (10_000 + rateBps));
  const tax = totalPaise - taxablePaise;
  if (!intraState) return { taxablePaise, cgstPaise: 0, sgstPaise: 0, igstPaise: tax, totalPaise };
  const cgstPaise = Math.floor(tax / 2);
  return { taxablePaise, cgstPaise, sgstPaise: tax - cgstPaise, igstPaise: 0, totalPaise };
}

/** Indian financial year (April–March), named by the year it starts, in IST. */
export function financialYear(d: Date): number {
  const ist = new Date(d.getTime() + 5.5 * 3600_000);
  return ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
}

export const invoiceNumber = (fy: number, n: number) => `INV-${fy}-${String(n).padStart(4, "0")}`;

/** "₹1,234.50" from paise. */
export const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const two = (n: number) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`);
const three = (n: number) => [n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred` : "", two(n % 100)].filter(Boolean).join(" ");

/** 17700000 → "Rupees One Lakh Seventy Seven Thousand Only" (Indian numbering, paise if any). */
export function rupeesInWords(paise: number): string {
  const r = Math.floor(paise / 100);
  const p = paise % 100;
  const parts: string[] = [];
  const crore = Math.floor(r / 1e7);
  const lakh = Math.floor((r % 1e7) / 1e5);
  const thousand = Math.floor((r % 1e5) / 1e3);
  const rest = r % 1e3;
  if (crore) parts.push(`${three(crore)} Crore`);
  if (lakh) parts.push(`${two(lakh)} Lakh`);
  if (thousand) parts.push(`${two(thousand)} Thousand`);
  if (rest) parts.push(three(rest));
  const words = parts.join(" ") || "Zero";
  return `Rupees ${words}${p ? ` and ${two(p)} Paise` : ""} Only`;
}

/** GSTIN: 2-digit state code, PAN, entity number, "Z", check character. */
export const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** GST state and union-territory codes (place of supply). */
export const GST_STATES: { code: string; name: string }[] = [
  { code: "35", name: "Andaman and Nicobar Islands" },
  { code: "37", name: "Andhra Pradesh" },
  { code: "12", name: "Arunachal Pradesh" },
  { code: "18", name: "Assam" },
  { code: "10", name: "Bihar" },
  { code: "04", name: "Chandigarh" },
  { code: "22", name: "Chhattisgarh" },
  { code: "26", name: "Dadra and Nagar Haveli and Daman and Diu" },
  { code: "07", name: "Delhi" },
  { code: "30", name: "Goa" },
  { code: "24", name: "Gujarat" },
  { code: "06", name: "Haryana" },
  { code: "02", name: "Himachal Pradesh" },
  { code: "01", name: "Jammu and Kashmir" },
  { code: "20", name: "Jharkhand" },
  { code: "29", name: "Karnataka" },
  { code: "32", name: "Kerala" },
  { code: "38", name: "Ladakh" },
  { code: "31", name: "Lakshadweep" },
  { code: "23", name: "Madhya Pradesh" },
  { code: "27", name: "Maharashtra" },
  { code: "14", name: "Manipur" },
  { code: "17", name: "Meghalaya" },
  { code: "15", name: "Mizoram" },
  { code: "13", name: "Nagaland" },
  { code: "21", name: "Odisha" },
  { code: "34", name: "Puducherry" },
  { code: "03", name: "Punjab" },
  { code: "08", name: "Rajasthan" },
  { code: "11", name: "Sikkim" },
  { code: "33", name: "Tamil Nadu" },
  { code: "36", name: "Telangana" },
  { code: "16", name: "Tripura" },
  { code: "09", name: "Uttar Pradesh" },
  { code: "05", name: "Uttarakhand" },
  { code: "19", name: "West Bengal" },
];
export const stateName = (code: string) => GST_STATES.find((s) => s.code === code)?.name ?? code;
