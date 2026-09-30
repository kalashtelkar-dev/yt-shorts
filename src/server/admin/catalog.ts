import "server-only";
import { z } from "zod";
import { db, type CatalogItemRow } from "@/db/client";
import { Prisma } from "@/generated/prisma/client";
import type { ActionResult } from "@/lib/jobs";
import { checkExpression, sourceOf } from "@/server/catalog";
import { STYLE_INPUTS } from "@/server/jobs/staged";
import { enginex } from "@/server/enginex/client";
import { EngineXError } from "@/server/enginex/types";
import type { Admin } from "./guard";

// Catalog admin (PLAN.md §1.2, §5.2): edits apply to new jobs immediately; running jobs keep their snapshot.

const ident = z.string().regex(/^[A-Za-z_]\w*$/, "Use letters, numbers and _ only, starting with a letter");

const fieldSchema = z.strictObject({
  name: ident,
  label: z.string().min(1).max(80),
  type: z.enum(["text", "url", "textarea", "range"]),
  required: z.boolean().optional(),
  max: z.number().int().positive().max(10_000).optional(),
  maxFrom: z.literal("durationSec").optional(),
  advanced: z.boolean().optional(),
  help: z.string().max(200).optional(),
});

const inputMapSchema = z.record(ident, z.union([z.string().max(500), z.number(), z.boolean()])).superRefine((map, ctx) => {
  for (const [k, v] of Object.entries(map)) {
    const problem = checkExpression(v);
    if (problem) ctx.addIssue({ code: "custom", path: [k], message: problem });
  }
});

export const catalogInput = z
  .strictObject({
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and dashes, like kill-montage")
      .max(64),
    title: z.string().trim().min(1).max(80),
    description: z.string().trim().max(300),
    templateId: z.string().trim().min(1).max(100),
    uploadTemplateId: z
      .string()
      .trim()
      .max(100)
      .nullish()
      .transform((v) => v || null),
    indexTemplates: z
      .strictObject({
        gameplay: z.string().trim().min(1).max(100),
        gameplayUpload: z
          .string()
          .trim()
          .max(100)
          .nullish()
          .transform((v) => v || null),
        song: z.string().trim().min(1).max(100),
        songUpload: z
          .string()
          .trim()
          .max(100)
          .nullish()
          .transform((v) => v || null),
      })
      .nullish()
      .transform((v) => v ?? null),
    enabled: z.boolean(),
    beta: z.boolean(),
    sortOrder: z.number().int().min(0).max(1000),
    durations: z.array(z.number().int().min(5).max(600)).min(1).max(6),
    creditRanges: z.record(
      z.string().regex(/^\d+$/),
      z
        .strictObject({ min: z.number().int().min(1).max(1_000_000), max: z.number().int().min(1).max(1_000_000) })
        .refine((r) => r.min <= r.max, "The lowest can't be more than the highest"),
    ),
    fields: z.array(fieldSchema).max(10),
    inputMap: inputMapSchema,
    stageMap: z
      .array(
        z.strictObject({
          match: z.string().min(1).max(64),
          label: z.string().min(1).max(60),
          itemSeconds: z.number().int().min(1).max(3600).optional(),
          only: z.enum(["url", "upload"]).optional(),
        }),
      )
      .max(40),
    outputKey: ident,
  })
  .superRefine((v, ctx) => {
    for (const d of v.durations)
      if (!v.creditRanges[String(d)]) ctx.addIssue({ code: "custom", path: ["creditRanges"], message: `Set the credits range for ${d} s` });
    const names = v.fields.map((f) => f.name);
    if (new Set(names).size !== names.length) ctx.addIssue({ code: "custom", path: ["fields"], message: "Two fields have the same name" });
    for (const [k, expr] of Object.entries(v.inputMap)) {
      const m = typeof expr === "string" ? /^\$fields\.(\w+)/.exec(expr) : null;
      if (m && !names.includes(m[1])) ctx.addIssue({ code: "custom", path: ["inputMap", k], message: `${expr} refers to a field that doesn't exist` });
    }
  });
export type CatalogInput = z.infer<typeof catalogInput>;

export type ValidationReport = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  pipeline: { name: string; version: number | null; publishedVersion: number | null; inputs: { name: string; required: boolean }[]; outputs: string[] } | null;
};

/**
 * Checks a template against Engine X and against the item's inputMap / outputKey. With `source`, the
 * other source's entries ($source.url vs $source.key/name) are ignored: they're empty for this template.
 */
export async function validateTemplate(
  templateId: string,
  inputMap: Record<string, unknown>,
  outputKey: string,
  source?: "url" | "upload",
): Promise<ValidationReport> {
  if (source)
    inputMap = Object.fromEntries(
      Object.entries(inputMap).filter(([, expr]) => {
        const s = sourceOf(expr);
        return !s || s === source;
      }),
    );
  let p;
  try {
    p = await enginex().getPipeline(templateId);
  } catch (e) {
    const err = e instanceof EngineXError ? e : null;
    const msg =
      err?.status === 404
        ? `No pipeline with ID ${templateId}.`
        : err?.status === 403
          ? "The Engine X key isn't allowed to use this pipeline."
          : `Couldn't reach Engine X to check this template (${err?.code ?? "error"}). Try again.`;
    return { ok: false, errors: [msg], warnings: [], pipeline: null };
  }
  const errors: string[] = [];
  const warnings: string[] = [];
  if (p.publishedVersion === null) errors.push("This pipeline has never been published, so it can't run. Publish it in Engine X first.");
  else if (p.version !== null && p.version > p.publishedVersion)
    warnings.push(`Engine X has an unpublished draft (v${p.version}); jobs run the published v${p.publishedVersion}.`);
  if (!p.compiles) errors.push("This pipeline doesn't compile in Engine X.");
  const names = p.inputs.map((i) => i.name);
  const mapped = Object.keys(inputMap);
  for (const i of p.inputs) if (i.required && !mapped.includes(i.name)) errors.push(`The pipeline needs "${i.name}" but the input map doesn't provide it.`);
  for (const k of mapped) if (!names.includes(k)) warnings.push(`The input map sends "${k}", which this pipeline doesn't declare. Engine X may reject it.`);
  if (p.outputs.length && !p.outputs.includes(outputKey)) errors.push(`The pipeline has no "${outputKey}" output. It has: ${p.outputs.join(", ")}.`);
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    pipeline: {
      name: p.name,
      version: p.version,
      publishedVersion: p.publishedVersion,
      inputs: p.inputs.map(({ name, required }) => ({ name, required })),
      outputs: p.outputs,
    },
  };
}

const pick = (map: Record<string, unknown>, keys: string[]) => Object.fromEntries(Object.entries(map).filter(([k]) => keys.includes(k)));
function merge(reports: [string, ValidationReport][]): ValidationReport {
  const [, main] = reports[0];
  return {
    ok: reports.every(([, r]) => r.ok),
    errors: reports.flatMap(([label, r]) => r.errors.map((e) => (label ? `${label}: ${e}` : e))),
    warnings: reports.flatMap(([label, r]) => r.warnings.map((w) => (label ? `${label}: ${w}` : w))),
    pipeline: main.pipeline,
  };
}

/**
 * Validates a catalog item's pipelines. Single styles: the template (and the upload template) against the input map.
 * Staged styles: the style pipeline against what the app sends it, and each index pipeline against the mapped inputs.
 */
export async function validateItem(
  item: Pick<CatalogInput, "templateId" | "uploadTemplateId" | "indexTemplates" | "inputMap" | "outputKey">,
): Promise<ValidationReport> {
  const t = item.indexTemplates;
  if (!t) {
    const reports: [string, ValidationReport][] = [["", await validateTemplate(item.templateId, item.inputMap, item.outputKey, "url")]];
    if (item.uploadTemplateId) reports.push(["Upload template", await validateTemplate(item.uploadTemplateId, item.inputMap, item.outputKey, "upload")]);
    return merge(reports);
  }
  const style = await validateTemplate(item.templateId, Object.fromEntries(STYLE_INPUTS.map((k) => [k, "x"])), item.outputKey);
  // The app sends a style only the inputs it declares (staged.ts), so "sends X it doesn't declare" doesn't apply.
  style.warnings = style.warnings.filter((w) => !w.startsWith("The input map sends"));
  const reports: [string, ValidationReport][] = [
    ["", style],
    ["Gameplay index", await validateTemplate(t.gameplay, pick(item.inputMap, ["youtubeUrl", "playerName"]), "kills")],
    ["Song index", await validateTemplate(t.song, pick(item.inputMap, ["musicUrl"]), "audio")],
  ];
  if (t.gameplayUpload)
    reports.push(["Gameplay index (uploads)", await validateTemplate(t.gameplayUpload, pick(item.inputMap, ["video", "playerName"]), "kills")]);
  // the uploaded song's key goes in as "audio" (staged.ts indexInputs), not through the input map
  if (t.songUpload) reports.push(["Song index (uploads)", await validateTemplate(t.songUpload, { audio: "the uploaded song" }, "audio")]);
  return merge(reports);
}

const snapshot = (r: CatalogItemRow) => {
  const { createdAt: _c, updatedAt: _u, ...rest } = r;
  return rest as Prisma.InputJsonValue;
};

/**
 * Create (id = null) or update a catalog item. Re-validates against Engine X whenever the
 * template, input map or output key changes, and refuses to save if validation has errors.
 */
export async function saveCatalogItem(admin: Admin, id: string | null, raw: unknown): Promise<ActionResult<{ id: string; report: ValidationReport | null }>> {
  const parsed = catalogInput.safeParse(raw);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return { ok: false, error: { code: "invalid", message: `${i.path.join(".") || "Form"}: ${i.message}`, field: String(i.path[0] ?? "") } };
  }
  const input = parsed.data;
  const before = id ? await db.catalogItem.findUnique({ where: { id } }) : null;
  if (id && !before) return { ok: false, error: { code: "not_found", message: "That catalog item doesn't exist any more." } };

  const pipelinesChanged =
    !before ||
    JSON.stringify(before.inputMap) !== JSON.stringify(input.inputMap) ||
    before.outputKey !== input.outputKey ||
    before.templateId !== input.templateId ||
    before.uploadTemplateId !== input.uploadTemplateId ||
    JSON.stringify(before.indexTemplates) !== JSON.stringify(input.indexTemplates);
  const report = pipelinesChanged ? await validateItem(input) : null;
  if (report && !report.ok) return { ok: false, error: { code: "validation", message: report.errors.join(" ") } };

  try {
    const data = { ...input, indexTemplates: input.indexTemplates ?? Prisma.DbNull };
    const saved = await db.$transaction(async (tx) => {
      const row = before ? await tx.catalogItem.update({ where: { id: before.id }, data }) : await tx.catalogItem.create({ data });
      await tx.catalogRevision.create({ data: { catalogItemId: row.id, snapshot: snapshot(row), changedBy: admin.id } });
      await tx.adminAuditLog.create({
        data: {
          adminId: admin.id,
          action: before ? "catalog.update" : "catalog.create",
          target: `catalog:${row.id}`,
          before: before ? snapshot(before) : Prisma.DbNull,
          after: snapshot(row),
        },
      });
      return row;
    });
    return { ok: true, data: { id: saved.id, report } };
  } catch (e) {
    // The slug is the only unique column an admin sets.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, error: { code: "invalid", message: "Another item already uses that slug.", field: "slug" } };
    }
    throw e;
  }
}

/** Items that have jobs can't be deleted (job history points at them); disable them instead. */
export async function deleteCatalogItem(admin: Admin, id: string): Promise<ActionResult<null>> {
  return db.$transaction(async (tx) => {
    const row = await tx.catalogItem.findUnique({ where: { id } });
    if (!row) return { ok: false as const, error: { code: "not_found", message: "That catalog item doesn't exist." } };
    const n = await tx.job.count({ where: { catalogItemId: id } });
    if (n > 0)
      return { ok: false as const, error: { code: "in_use", message: `${n} job${n === 1 ? "" : "s"} use this item. Switch it off instead of deleting it.` } };
    await tx.adminAuditLog.create({
      data: { adminId: admin.id, action: "catalog.delete", target: `catalog:${id}`, before: snapshot(row), after: Prisma.DbNull },
    });
    await tx.catalogItem.delete({ where: { id } });
    return { ok: true as const, data: null };
  });
}

type PipelineRow = Pick<CatalogItemRow, "title" | "enabled" | "templateId" | "uploadTemplateId" | "indexTemplates">;
export const PIPELINE_GROUPS = ["Style", "Upload (one-run styles)", "Gameplay from a link", "Gameplay from an upload", "Song", "Song from an upload"] as const;
export type PipelineGroup = { group: (typeof PIPELINE_GROUPS)[number]; pipelines: { templateId: string; usedBy: string[] }[] };

/** Every Engine X pipeline the catalog uses, grouped by stage, each with the styles that use it (disabled ones marked "off"). */
export function pipelinesInUse(items: PipelineRow[]): PipelineGroup[] {
  const groups = new Map(PIPELINE_GROUPS.map((g) => [g, new Map<string, string[]>()]));
  const add = (g: (typeof PIPELINE_GROUPS)[number], id: string | null | undefined, item: PipelineRow) => {
    if (!id) return;
    const m = groups.get(g)!;
    m.set(id, [...(m.get(id) ?? []), item.enabled ? item.title : `${item.title} (off)`]);
  };
  for (const i of items) {
    add("Style", i.templateId, i);
    add("Upload (one-run styles)", i.uploadTemplateId, i);
    add("Gameplay from a link", i.indexTemplates?.gameplay, i);
    add("Gameplay from an upload", i.indexTemplates?.gameplayUpload, i);
    add("Song", i.indexTemplates?.song, i);
    add("Song from an upload", i.indexTemplates?.songUpload, i);
  }
  return PIPELINE_GROUPS.map((group) => ({ group, pipelines: [...groups.get(group)!].map(([templateId, usedBy]) => ({ templateId, usedBy })) })).filter(
    (g) => g.pipelines.length > 0,
  );
}

export async function listCatalog() {
  return db.catalogItem.findMany({ orderBy: [{ sortOrder: "asc" }, { title: "asc" }] });
}

export async function catalogItemWithRevisions(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const item = await db.catalogItem.findUnique({ where: { id } });
  if (!item) return null;
  const rows = await db.catalogRevision.findMany({
    where: { catalogItemId: id },
    select: { id: true, snapshot: true, createdAt: true, changedByUser: { select: { email: true } } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const revisions = rows.map(({ changedByUser, ...r }) => ({ ...r, email: changedByUser?.email ?? null }));
  return { item, revisions };
}
