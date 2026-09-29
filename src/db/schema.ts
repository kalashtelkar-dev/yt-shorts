import { sql } from "drizzle-orm";
import type { RunStep } from "@/server/enginex/types";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  type AnyPgColumn,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// ── Better Auth (core tables + anonymous plugin + our role/suspension fields) ──

export const userRole = pgEnum("user_role", ["user", "admin"]);

export const users = pgTable("users", {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: boolean().notNull().default(false),
  image: text(),
  isAnonymous: boolean().notNull().default(false),
  role: userRole().notNull().default("user"),
  suspendedAt: timestamp({ withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: text().primaryKey(),
    token: text().notNull().unique(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    ipAddress: text(),
    userAgent: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: text().primaryKey(),
    accountId: text().notNull(),
    providerId: text().notNull(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: timestamp({ withTimezone: true }),
    refreshTokenExpiresAt: timestamp({ withTimezone: true }),
    scope: text(),
    password: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.userId)],
);

export const verifications = pgTable(
  "verifications",
  {
    id: text().primaryKey(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.identifier)],
);

// ── Catalog ──

export type CatalogField = {
  name: string;
  label: string;
  type: "text" | "url" | "textarea" | "range";
  required?: boolean;
  max?: number;
  maxFrom?: "durationSec";
  advanced?: boolean;
  help?: string;
};
export type InputMap = Record<string, string | number | boolean>;
/**
 * `itemSeconds`: for fan-out steps, seconds of video per item, so progress can say "4:10 of 24:00 scanned".
 * `only`: show this stage only for link or upload jobs (e.g. downloading happens only for links).
 */
export type StageMapEntry = { match: string; label: string; itemSeconds?: number; only?: "url" | "upload" };
/**
 * A staged style (docs/edit-styles/README.md): the gameplay and the song are indexed by their own pipelines
 * (results cached in media_index), then `templateId` is the style pipeline that plans and renders.
 */
export type IndexTemplates = { gameplay: string; gameplayUpload?: string | null; song: string };
export type CreditRange = { min: number; max: number };

export const catalogItems = pgTable("catalog_items", {
  id: uuid().primaryKey().defaultRandom(),
  slug: text().notNull().unique(),
  title: text().notNull(),
  description: text().notNull().default(""),
  templateId: text().notNull(),
  /** Optional pipeline for uploaded files (no download step). Null = uploads not offered for this style. */
  uploadTemplateId: text(),
  /** Set for staged styles: the index pipelines that feed the style pipeline in templateId. */
  indexTemplates: jsonb().$type<IndexTemplates>(),
  enabled: boolean().notNull().default(true),
  beta: boolean().notNull().default(false),
  sortOrder: integer().notNull().default(0),
  durations: integer().array().notNull().default(sql`'{30,60,90}'::integer[]`),
  fields: jsonb().$type<CatalogField[]>().notNull().default([]),
  inputMap: jsonb().$type<InputMap>().notNull().default({}),
  stageMap: jsonb().$type<StageMapEntry[]>().notNull().default([]),
  outputKey: text().notNull().default("montage"),
  /**
   * Expected credits per length, e.g. {"30": {"min": 150, "max": 420}}. Users see the range before they start and
   * need `max` available to start; they pay for the editing time actually used, after it's made (1 credit a second).
   */
  creditRanges: jsonb().$type<Record<string, CreditRange>>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const catalogRevisions = pgTable(
  "catalog_revisions",
  {
    id: uuid().primaryKey().defaultRandom(),
    catalogItemId: uuid()
      .notNull()
      .references(() => catalogItems.id, { onDelete: "cascade" }),
    snapshot: jsonb().notNull(),
    changedBy: text().references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.catalogItemId, t.createdAt)],
);

// ── Jobs ──

export const jobStatus = pgEnum("job_status", ["queued", "starting", "running", "succeeded", "failed", "canceled"]);
export const jobSource = pgEnum("job_source", ["url", "upload"]);
export const eventLevel = pgEnum("event_level", ["info", "warn", "error"]);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    catalogItemId: uuid()
      .notNull()
      .references(() => catalogItems.id),
    // Snapshot at start; never re-read from the catalog later.
    catalogSlug: text().notNull(),
    templateId: text().notNull(),
    templateVersion: text(),
    /** Staged jobs: snapshot of the index pipelines, the index rows they use, and which phase they're in. */
    indexTemplates: jsonb().$type<IndexTemplates>(),
    gameplayIndexId: uuid(),
    songIndexId: uuid(),
    phase: text().$type<"index" | "render">(),
    /** Steps the index phase took, so progress doesn't jump back when the render run starts. */
    indexSteps: integer().notNull().default(0),
    input: jsonb().notNull(),
    source: jobSource().notNull(),
    sourceUrl: text(),
    uploadKey: text(),
    durationSec: integer().notNull(),
    status: jobStatus().notNull().default("queued"),
    runId: text().unique(),
    stepsTotal: integer().notNull().default(0),
    stepsDone: integer().notNull().default(0),
    currentStage: text(),
    stageDetail: text(),
    retries: integer().notNull().default(0),
    outputKey: text(),
    outputMeta: jsonb(),
    errorPublic: text(),
    errorRaw: text(),
    runMs: integer(),
    /** Credits used, charged after the job succeeds (0 until then, and for failed jobs). */
    chargedCredits: integer().notNull().default(0),
    /** The top of the range at start: held against the balance while the job runs, so parallel jobs can't overspend. */
    maxCredits: integer().notNull().default(0),
    computeCostPaise: integer(),
    createdAt: createdAt(),
    startedAt: timestamp({ withTimezone: true }),
    finishedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index().on(t.userId, t.createdAt.desc()),
    index().on(t.status),
  ],
);

export const mediaIndexKind = pgEnum("media_index_kind", ["gameplay", "song"]);
export const mediaIndexStatus = pgEnum("media_index_status", ["running", "succeeded", "failed"]);

/**
 * Results of the index pipelines (gameplay-index, song-index), shared by every job that uses the same
 * pipeline and input. cacheKey = hash(template, source, player). Engine X outputs expire, so a row is reused
 * only for a while after it finished (see staged.ts).
 */
export const mediaIndex = pgTable(
  "media_index",
  {
    id: uuid().primaryKey().defaultRandom(),
    kind: mediaIndexKind().notNull(),
    cacheKey: text().notNull().unique(),
    templateId: text().notNull(),
    input: jsonb().$type<Record<string, string>>().notNull(),
    runId: text(),
    status: mediaIndexStatus().notNull().default("running"),
    output: jsonb().$type<Record<string, unknown>>(),
    /** The run's steps as last polled; each job labels them with its own catalog stageMap. */
    steps: jsonb().$type<RunStep[]>().notNull().default([]),
    stepsDone: integer().notNull().default(0),
    stepsTotal: integer().notNull().default(0),
    error: text(),
    runMs: integer(),
    startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp({ withTimezone: true }),
  },
  (t) => [index().on(t.status)],
);

export const jobEvents = pgTable(
  "job_events",
  {
    id: uuid().primaryKey().defaultRandom(),
    jobId: uuid()
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    level: eventLevel().notNull().default("info"),
    message: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.jobId, t.createdAt)],
);

// ── Credits ──

export const ledgerKind = pgEnum("ledger_kind", [
  "grant",
  "admin_add",
  "admin_remove",
  "reserve",
  "release",
  "charge",
  "purchase",
  "refund",
  "transfer", // a guest's balance moving to the account they signed up with (a pair of rows, − and +)
]);

// Append-only: a trigger in the migrations rejects UPDATE and DELETE.
// Jobs use "charge" after they succeed (older jobs were charged at start and refunded on failure);
// "purchase" is a paid top-up (paymentId set); reserve/release are unused legacy kinds.
export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text()
      .notNull()
      .references(() => users.id),
    delta: integer().notNull(),
    kind: ledgerKind().notNull(),
    jobId: uuid().references(() => jobs.id),
    paymentId: uuid().references((): AnyPgColumn => payments.id),
    adminId: text().references(() => users.id),
    reason: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.userId, t.createdAt),
    // One charge and at most one refund per job: makes lifecycle steps idempotent in the DB.
    uniqueIndex().on(t.jobId, t.kind).where(sql`${t.jobId} is not null`),
    // One purchase row per payment, however many times the webhook and the browser both confirm it.
    uniqueIndex().on(t.paymentId).where(sql`${t.paymentId} is not null`),
  ],
);

export const userBalances = pgTable("user_balances", {
  userId: text()
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  balance: integer().notNull().default(0),
  updatedAt: updatedAt(),
});

// ── Settings (single row, id = 1) ──

export const settings = pgTable(
  "settings",
  {
    id: integer().primaryKey().default(1),
    costPaisePerSecond: integer().notNull().default(20),
    /** What users pay per credit, GST included. */
    sellPaisePerCredit: integer().notNull().default(20),
    /** Smallest top-up, GST included. */
    minPurchasePaise: integer().notNull().default(10000),
    maxPurchasePaise: integer().notNull().default(500000),
    gstRateBps: integer().notNull().default(1800),
    /** The business on tax invoices (name, address, GSTIN…). Snapshotted onto each invoice. */
    seller: jsonb().$type<Seller>().notNull().default({}),
    starterCredits: integer().notNull().default(600),
    maxUploadMb: integer().notNull().default(2048),
    maxConcurrentJobsPerUser: integer().notNull().default(2),
    maxRunMinutes: integer().notNull().default(60),
    updatedAt: updatedAt(),
  },
  (t) => [check("settings_single_row", sql`${t.id} = 1`)],
);

export type Seller = {
  legalName?: string;
  address?: string;
  stateCode?: string;
  gstin?: string;
  pan?: string;
  email?: string;
  phone?: string;
  website?: string;
  sac?: string;
  signatory?: string;
};

// ── Payments and tax invoices ──

export const paymentStatus = pgEnum("payment_status", ["created", "paid", "failed"]);

/** One checkout: created before the payment sheet opens, marked paid once the provider's signature checks out. */
export const payments = pgTable(
  "payments",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text()
      .notNull()
      .references(() => users.id),
    provider: text().notNull(), // 'razorpay' | 'mock'
    providerOrderId: text().notNull().unique(),
    providerPaymentId: text().unique(),
    amountPaise: integer().notNull(), // GST included
    credits: integer().notNull(),
    status: paymentStatus().notNull().default("created"),
    method: text(),
    raw: jsonb(),
    createdAt: createdAt(),
    paidAt: timestamp({ withTimezone: true }),
  },
  (t) => [index().on(t.userId, t.createdAt.desc()), index().on(t.status, t.createdAt.desc())],
);

/** Buyer details for tax invoices, asked once at the first purchase. */
export const billingProfiles = pgTable("billing_profiles", {
  userId: text()
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  stateCode: text().notNull(), // GST state code, e.g. "29" for Karnataka
  legalName: text(),
  gstin: text(),
  updatedAt: updatedAt(),
});

/** A tax invoice per paid payment. Seller and buyer are snapshots, so later edits don't change old invoices. */
export const invoices = pgTable(
  "invoices",
  {
    id: uuid().primaryKey().defaultRandom(),
    number: text().notNull().unique(), // INV-<financial year>-<4+ digits>
    userId: text()
      .notNull()
      .references(() => users.id),
    paymentId: uuid()
      .notNull()
      .unique()
      .references(() => payments.id),
    seller: jsonb().$type<Seller>().notNull(),
    buyer: jsonb().$type<{ email: string; legalName: string | null; gstin: string | null; stateCode: string }>().notNull(),
    credits: integer().notNull(),
    taxablePaise: integer().notNull(),
    cgstPaise: integer().notNull().default(0),
    sgstPaise: integer().notNull().default(0),
    igstPaise: integer().notNull().default(0),
    totalPaise: integer().notNull(),
    gstRateBps: integer().notNull(),
    issuedAt: createdAt(),
  },
  (t) => [index().on(t.userId, t.issuedAt.desc())],
);

/** Next invoice number per financial year, taken with one atomic UPDATE … RETURNING. */
export const invoiceCounters = pgTable("invoice_counters", {
  fy: integer().primaryKey(), // the year the financial year starts (April)
  last: integer().notNull().default(0),
});

// ── Admin audit ──

export const adminAuditLog = pgTable(
  "admin_audit_log",
  {
    id: uuid().primaryKey().defaultRandom(),
    adminId: text()
      .notNull()
      .references(() => users.id),
    action: text().notNull(),
    target: text().notNull(),
    before: jsonb(),
    after: jsonb(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.createdAt.desc())],
);

// ── Service health (PLAN.md §6) ──

export const probeStatus = pgEnum("probe_status", ["up", "degraded", "down", "not_configured"]);

// Raw checks, kept 8 days (enough for the 24 h and 7 d views).
export const probeResults = pgTable(
  "probe_results",
  {
    id: uuid().primaryKey().defaultRandom(),
    probeId: text().notNull(),
    status: probeStatus().notNull(),
    latencyMs: integer(),
    message: text(),
    checkedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.probeId, t.checkedAt.desc()), index().on(t.checkedAt)],
);

// Daily rollup, updated on every check and kept 90 days (the 90 d view).
export const probeDaily = pgTable(
  "probe_daily",
  {
    probeId: text().notNull(),
    day: text().notNull(), // YYYY-MM-DD (UTC)
    checks: integer().notNull().default(0),
    up: integer().notNull().default(0),
    degraded: integer().notNull().default(0),
    down: integer().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.probeId, t.day] })],
);

// A probe failing 2 checks in a row opens an incident; 2 good checks in a row resolve it.
export const incidents = pgTable(
  "incidents",
  {
    id: uuid().primaryKey().defaultRandom(),
    probeId: text().notNull(),
    severity: probeStatus().notNull(), // 'degraded' or 'down' (escalates to down, never back)
    startedAt: timestamp({ withTimezone: true }).notNull(),
    resolvedAt: timestamp({ withTimezone: true }),
    lastMessage: text(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // At most one open incident per probe, enforced by the database.
    uniqueIndex().on(t.probeId).where(sql`${t.resolvedAt} is null`),
    index().on(t.startedAt.desc()),
  ],
);
