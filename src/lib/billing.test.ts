import { describe, expect, it } from "vitest";
import { creditsForPaise, creditsForRun, financialYear, GSTIN_RE, invoiceNumber, purchaseAmounts, rupeesInWords, splitGst } from "./billing";

describe("credits", () => {
  it("charges a credit per second, rounded up", () => {
    expect(creditsForRun(0)).toBe(0);
    expect(creditsForRun(1)).toBe(1);
    expect(creditsForRun(309_000)).toBe(309);
    expect(creditsForRun(309_001)).toBe(310);
  });
  it("buys credits at the GST-inclusive price", () => {
    expect(creditsForPaise(10_000, 20)).toBe(500); // ₹100 at ₹0.20 → 500
    expect(creditsForPaise(15_010, 20)).toBe(750);
    expect(creditsForPaise(10_000, 0)).toBe(0);
  });
  it("offers wheel amounts inside the limits, starting at the minimum", () => {
    expect(purchaseAmounts(10_000, 50_000)).toEqual([100, 150, 200, 250, 300, 400, 500]);
    expect(purchaseAmounts(12_000, 20_000)).toEqual([120, 150, 200]);
  });
});

describe("GST", () => {
  it("splits an inclusive total so the parts add up exactly", () => {
    for (const total of [10_000, 15_000, 177_000_00, 12_345]) {
      for (const intra of [true, false]) {
        const s = splitGst(total, 1800, intra);
        expect(s.taxablePaise + s.cgstPaise + s.sgstPaise + s.igstPaise).toBe(total);
      }
    }
  });
  it("uses CGST + SGST inside the state and IGST outside", () => {
    expect(splitGst(10_000, 1800, true)).toEqual({ taxablePaise: 8475, cgstPaise: 762, sgstPaise: 763, igstPaise: 0, totalPaise: 10_000 });
    expect(splitGst(10_000, 1800, false)).toEqual({ taxablePaise: 8475, cgstPaise: 0, sgstPaise: 0, igstPaise: 1525, totalPaise: 10_000 });
    expect(splitGst(177_000_00, 1800, true)).toMatchObject({ taxablePaise: 150_000_00, cgstPaise: 13_500_00, sgstPaise: 13_500_00 });
  });
  it("validates GSTINs", () => {
    expect(GSTIN_RE.test("29AALCD7580N1ZQ")).toBe(true);
    expect(GSTIN_RE.test("29aalcd7580n1zq")).toBe(false);
    expect(GSTIN_RE.test("29AALCD7580N1Q")).toBe(false);
  });
});

describe("invoices", () => {
  it("names the financial year by its April start, in IST", () => {
    expect(financialYear(new Date("2026-08-20T10:00:00Z"))).toBe(2026);
    expect(financialYear(new Date("2027-02-01T10:00:00Z"))).toBe(2026);
    expect(financialYear(new Date("2027-03-31T19:00:00Z"))).toBe(2027); // already 1 April in IST
    expect(invoiceNumber(2026, 34)).toBe("INV-2026-0034");
    expect(invoiceNumber(2026, 12345)).toBe("INV-2026-12345");
  });
  it("writes amounts in Indian words", () => {
    expect(rupeesInWords(177_000_00)).toBe("Rupees One Lakh Seventy Seven Thousand Only");
    expect(rupeesInWords(10_000)).toBe("Rupees One Hundred Only");
    expect(rupeesInWords(15_050)).toBe("Rupees One Hundred Fifty and Fifty Paise Only");
    expect(rupeesInWords(2_50_00_000_00)).toBe("Rupees Two Crore Fifty Lakh Only");
  });
});
