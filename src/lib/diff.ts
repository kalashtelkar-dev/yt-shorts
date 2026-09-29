// What changed between two audit snapshots, field by field, for the audit log.

export type Change = { field: string; before: string; after: string };

const show = (v: unknown) => (v === undefined || v === null ? "—" : typeof v === "string" ? v : JSON.stringify(v));
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Fields whose values differ, nested objects by their inner fields (one row for non-object values). Unchanged fields are left out. */
export function changes(before: unknown, after: unknown): Change[] {
  if (!isRecord(before) && !isRecord(after)) return JSON.stringify(before) === JSON.stringify(after) ? [] : [{ field: "value", before: show(before), after: show(after) }];
  const b = isRecord(before) ? before : {};
  const a = isRecord(after) ? after : {};
  return [...new Set([...Object.keys(b), ...Object.keys(a)])]
    .filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]))
    .flatMap((k) =>
      // Nested objects on both sides: name the inner fields that changed ("indexTemplates.gameplay").
      isRecord(b[k]) && isRecord(a[k]) ? changes(b[k], a[k]).map((c) => ({ ...c, field: `${k}.${c.field}` })) : [{ field: k, before: show(b[k]), after: show(a[k]) }],
    );
}
