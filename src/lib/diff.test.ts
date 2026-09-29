import { describe, expect, it } from "vitest";
import { changes } from "./diff";

describe("audit changes", () => {
  it("lists only the fields that changed", () => {
    expect(changes({ a: 1, b: { x: 1 }, c: "same" }, { a: 2, b: { x: 1 }, c: "same", d: true })).toEqual([
      { field: "a", before: "1", after: "2" },
      { field: "d", before: "—", after: "true" },
    ]);
  });
  it("handles creations, deletions and plain values", () => {
    expect(changes(null, { t: "x" })).toEqual([{ field: "t", before: "—", after: "x" }]);
    expect(changes({ t: "x" }, null)).toEqual([{ field: "t", before: "x", after: "—" }]);
    expect(changes(1, 2)).toEqual([{ field: "value", before: "1", after: "2" }]);
    expect(changes({ a: [1] }, { a: [1] })).toEqual([]);
  });
  it("names the inner fields of nested objects", () => {
    expect(changes({ t: { song: "s", gameplay: "g1" } }, { t: { song: "s", gameplay: "g2" } })).toEqual([{ field: "t.gameplay", before: "g1", after: "g2" }]);
  });
});
