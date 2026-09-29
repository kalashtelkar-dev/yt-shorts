import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { costReport, updateSettings } from "./billing";
import { deleteCatalogItem, pipelinesInUse, saveCatalogItem, validateTemplate } from "./catalog";
import type { Admin } from "./guard";

let admin: Admin;
let slug: string;

const base = () => ({
  slug,
  title: "Kill Montage",
  description: "Kills, cut fast",
  templateId: "tpl_ok",
  enabled: true,
  beta: false,
  sortOrder: 1,
  durations: [30, 60],
  creditRanges: { "30": { min: 120, max: 300 }, "60": { min: 200, max: 450 } },
  fields: [{ name: "playerName", label: "Your in-game name", type: "text", required: true, max: 32 }],
  inputMap: { youtubeUrl: "$source.url", playerName: "$fields.playerName", durationSec: "$durationSec" },
  stageMap: [{ match: "download", label: "Downloading" }, { match: "read_feed", label: "Reading", itemSeconds: 10 }],
  outputKey: "montage",
});

beforeEach(async () => {
  const id = crypto.randomUUID();
  await db.user.create({ data: { id, name: "a", email: `${id}@test.local`, role: "admin" } });
  admin = { id, email: `${id}@test.local`, name: "a" };
  slug = `km-${id.slice(0, 8)}`;
});

describe("pipelinesInUse", () => {
  it("groups every pipeline by stage and lists the styles that share it", () => {
    const index = { gameplay: "tpl_g", gameplayUpload: "tpl_gu", song: "tpl_s" };
    const groups = pipelinesInUse([
      { title: "Kill Montage", enabled: true, templateId: "tpl_k", uploadTemplateId: null, indexTemplates: index },
      { title: "Lyrical", enabled: false, templateId: "tpl_l", uploadTemplateId: null, indexTemplates: { ...index, gameplayUpload: null } },
    ]);
    expect(groups).toEqual([
      { group: "Style", pipelines: [{ templateId: "tpl_k", usedBy: ["Kill Montage"] }, { templateId: "tpl_l", usedBy: ["Lyrical (off)"] }] },
      { group: "Gameplay from a link", pipelines: [{ templateId: "tpl_g", usedBy: ["Kill Montage", "Lyrical (off)"] }] },
      { group: "Gameplay from an upload", pipelines: [{ templateId: "tpl_gu", usedBy: ["Kill Montage"] }] },
      { group: "Song", pipelines: [{ templateId: "tpl_s", usedBy: ["Kill Montage", "Lyrical (off)"] }] },
    ]);
  });
});

describe("validateTemplate (mock Engine X)", () => {
  it("passes a published template whose required inputs are mapped", async () => {
    expect(await validateTemplate("tpl_ok", { youtubeUrl: "$source.url", playerName: "x", durationSec: "$durationSec" }, "montage")).toMatchObject({ ok: true, errors: [] });
  });

  it("rejects unknown and unpublished templates", async () => {
    expect((await validateTemplate("tpl_missing", {}, "montage")).errors[0]).toMatch(/No pipeline/);
    expect((await validateTemplate("tpl_draft", {}, "montage")).errors.join()).toMatch(/never been published/);
  });

  it("errors on unmapped required inputs and a missing output; warns on unknown targets", async () => {
    const r = await validateTemplate("tpl_ok", { youtubeUrl: "$source.url", bogus: "1" }, "video");
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/needs "playerName"/);
    expect(r.errors.join()).toMatch(/no "video" output/);
    expect(r.warnings.join()).toMatch(/"bogus"/);
  });
});

describe("saveCatalogItem", () => {
  it("refuses to save when validation has errors", async () => {
    const r = await saveCatalogItem(admin, null, { ...base(), templateId: "tpl_lyrical" }); // needs the song inputs
    expect(r).toMatchObject({ ok: false, error: { code: "validation" } });
  });

  it("creates with a revision and audit entry; template swaps take effect and are recorded", async () => {
    const input = base();
    const created = await saveCatalogItem(admin, null, input);
    expect(created.ok).toBe(true);
    const id = created.ok ? created.data.id : "";

    const swapped = await saveCatalogItem(admin, id, { ...input, templateId: "tpl_new" });
    expect(swapped.ok).toBe(true);
    const row = await db.catalogItem.findUniqueOrThrow({ where: { id } });
    expect(row.templateId).toBe("tpl_new");
    expect(await db.catalogRevision.findMany({ where: { catalogItemId: id } })).toHaveLength(2);
    const audit = await db.adminAuditLog.findMany({ where: { target: `catalog:${id}` } });
    expect(audit.map((a) => a.action).sort()).toEqual(["catalog.create", "catalog.update"]);

    expect(await saveCatalogItem(admin, id, { ...input, templateId: "tpl_missing" })).toMatchObject({ ok: false });
    const still = await db.catalogItem.findUniqueOrThrow({ where: { id } });
    expect(still.templateId).toBe("tpl_new");
  });

  it("refuses a slug another item uses", async () => {
    await db.catalogItem.create({ data: { slug, title: "t", templateId: "tpl_ok" } });
    expect(await saveCatalogItem(admin, null, base())).toMatchObject({ ok: false, error: { code: "invalid", field: "slug" } });
  });

  it.each([
    [{ inputMap: { youtubeUrl: "${process.env.X}" } }, /isn't supported/],
    [{ inputMap: { playerName: "$fields.nope" } }, /doesn't exist/],
    [{ creditRanges: { "30": { min: 120, max: 300 } } }, /range for 60/],
    [{ creditRanges: { "30": { min: 400, max: 300 }, "60": { min: 200, max: 450 } } }, /lowest/],
    [{ slug: "Kill Montage" }, /lowercase/],
    [{ fields: [{ name: "a", label: "A", type: "text" }, { name: "a", label: "B", type: "text" }], inputMap: {} }, /same name/],
  ])("rejects bad input %j", async (patch, message) => {
    const r = await saveCatalogItem(admin, null, { ...base(), ...patch });
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error.message).toMatch(message);
  });

  it("won't delete an item that jobs used", async () => {
    const item = await db.catalogItem.create({ data: { slug, title: "t", templateId: "tpl_ok" } });
    await db.job.create({ data: { userId: admin.id, catalogItemId: item.id, catalogSlug: slug, templateId: "tpl_ok", input: {}, source: "url", durationSec: 30 } });
    expect(await deleteCatalogItem(admin, item.id)).toMatchObject({ ok: false, error: { code: "in_use" } });
  });
});

describe("billing", () => {
  it("updates settings with an audit entry, and validates", async () => {
    const before = await db.settings.findUnique({ where: { id: 1 } });
    const next = {
      costPaisePerSecond: 30,
      sellPaisePerCredit: 50,
      minPurchasePaise: 10_000,
      maxPurchasePaise: 500_000,
      gstRateBps: 1800,
      seller: { legalName: "Test Co", gstin: "29AALCD7580N1ZQ", stateCode: "29" },
      starterCredits: 600,
      maxUploadMb: 2048,
      maxConcurrentJobsPerUser: 2,
      maxRunMinutes: 60,
    };
    expect(await updateSettings(admin, next)).toMatchObject({ ok: true });
    expect(await updateSettings(admin, { ...next, maxRunMinutes: 1 })).toMatchObject({ ok: false });
    const log = await db.adminAuditLog.findMany({ where: { adminId: admin.id } });
    expect(log[0]).toMatchObject({ action: "settings.update", after: next });
    expect(await updateSettings(admin, { ...next, seller: { gstin: "not-a-gstin" } })).toMatchObject({ ok: false });
    expect(await updateSettings(admin, { ...next, minPurchasePaise: 600_000 })).toMatchObject({ ok: false });
    if (before) {
      const { id: _id, updatedAt: _u, ...rest } = before;
      await db.settings.update({ where: { id: 1 }, data: rest }); // the tests share the dev database
    }
  });

  it("reports cost and net credits per style and length", async () => {
    const item = await db.catalogItem.create({ data: { slug, title: "Report test", templateId: "tpl_ok", creditRanges: { "30": { min: 120, max: 300 } } } });
    const common = { userId: admin.id, catalogItemId: item.id, catalogSlug: slug, templateId: "tpl_ok", input: {}, source: "url" as const, durationSec: 30 };
    await db.job.createMany({ data: [
      { ...common, status: "succeeded", runMs: 100_000, computeCostPaise: 3000, chargedCredits: 300 },
      { ...common, status: "succeeded", runMs: 200_000, computeCostPaise: 6000, chargedCredits: 300 },
      { ...common, status: "failed", runMs: 50_000, computeCostPaise: 1500, chargedCredits: 300 },
    ] });
    const row = (await costReport(30)).rows.find((r) => r.slug === slug)!;
    expect(row).toMatchObject({ jobs: 3, succeeded: 2, medianRunMs: 150_000, costPaise: 10_500, failedCostPaise: 1500, netCredits: 600, range: { min: 120, max: 300 } });
  });
});
