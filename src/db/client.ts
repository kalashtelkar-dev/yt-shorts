import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import type { ITXClientDenyList } from "@prisma/client/runtime/client";
import { env } from "@/config/env";
import { PrismaClient } from "@/generated/prisma/client";
import type { Buyer, CatalogField, CreditRange, DownloadProgress, IndexTemplates, InputMap, JobPhase, RunStep, Seller, StageMapEntry } from "./types";

// JSON columns typed as their real shapes (src/db/types.ts) instead of Prisma's JsonValue. Types only: the extension is
// never applied, because extended rows carry a Symbol(nodejs.util.inspect.custom) that React refuses to pass to Client
// Components ("Only plain objects can be passed…"). Every compute is a plain cast, so the base client returns the same values.
const _typed = (client: PrismaClient) =>
  client.$extends({
    result: {
      catalogItem: {
        indexTemplates: { needs: { indexTemplates: true }, compute: (r) => r.indexTemplates as IndexTemplates | null },
        fields: { needs: { fields: true }, compute: (r) => r.fields as CatalogField[] },
        inputMap: { needs: { inputMap: true }, compute: (r) => r.inputMap as InputMap },
        stageMap: { needs: { stageMap: true }, compute: (r) => r.stageMap as StageMapEntry[] },
        creditRanges: { needs: { creditRanges: true }, compute: (r) => r.creditRanges as Record<string, CreditRange> },
      },
      job: {
        indexTemplates: { needs: { indexTemplates: true }, compute: (r) => r.indexTemplates as IndexTemplates | null },
        phase: { needs: { phase: true }, compute: (r) => r.phase as JobPhase | null },
        download: { needs: { download: true }, compute: (r) => r.download as DownloadProgress | null },
      },
      mediaIndex: {
        input: { needs: { input: true }, compute: (r) => r.input as Record<string, string> },
        output: { needs: { output: true }, compute: (r) => r.output as Record<string, unknown> | null },
        steps: { needs: { steps: true }, compute: (r) => r.steps as RunStep[] },
      },
      settings: { seller: { needs: { seller: true }, compute: (r) => r.seller as Seller } },
      invoice: { seller: { needs: { seller: true }, compute: (r) => r.seller as Seller }, buyer: { needs: { buyer: true }, compute: (r) => r.buyer as Buyer } },
    },
  });

function create() {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL, max: 10 });
  // Transactions wait on row locks (balances, payments), so give them longer than Prisma's 5 s default.
  const client = new PrismaClient({ adapter, transactionOptions: { maxWait: 10_000, timeout: 20_000 } });
  return client as unknown as ReturnType<typeof _typed>;
}

// One pool per process. Cached on globalThis so dev hot reloads reuse it instead of opening another
// 10 connections each time (which ran Postgres out of connections).
// (A new key when what's cached changes shape: a hot reload would otherwise keep the old client.)
const g = globalThis as unknown as { prismaPlain?: ReturnType<typeof create> };
export const db = (g.prismaPlain ??= create());

export type Db = typeof db;
/** The client inside `db.$transaction(async (tx) => …)`. */
export type Tx = Omit<Db, ITXClientDenyList>;

// Full rows as the client returns them, JSON columns typed. (Plain models without JSON columns:
// import their types from "@/generated/prisma/client", e.g. `Payment`, `User`.)
export type CatalogItemRow = NonNullable<Awaited<ReturnType<Db["catalogItem"]["findFirst"]>>>;
export type JobRow = NonNullable<Awaited<ReturnType<Db["job"]["findFirst"]>>>;
export type MediaIndexRow = NonNullable<Awaited<ReturnType<Db["mediaIndex"]["findFirst"]>>>;
export type SettingsRow = NonNullable<Awaited<ReturnType<Db["settings"]["findFirst"]>>>;
export type InvoiceRow = NonNullable<Awaited<ReturnType<Db["invoice"]["findFirst"]>>>;
