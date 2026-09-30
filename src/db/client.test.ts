import { describe, expect, it } from "vitest";
import { db } from "./client";

describe("db client", () => {
  it("returns plain rows that Server Components can pass to Client Components", async () => {
    await db.catalogItem.create({ data: { slug: `plain-${crypto.randomUUID()}`, title: "t", templateId: "tpl_t", fields: [{ name: "x" }] } });
    const [row] = await db.catalogItem.findMany({ select: { slug: true, fields: true, creditRanges: true }, take: 1 });
    expect(Object.getOwnPropertySymbols(row)).toEqual([]);
    expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
  });
});
