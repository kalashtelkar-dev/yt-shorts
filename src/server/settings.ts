import "server-only";
import { db, type SettingsRow } from "@/db/client";

export type Settings = SettingsRow;

export async function getSettings(): Promise<Settings> {
  const row = await db.settings.findUnique({ where: { id: 1 } });
  if (row) return row;
  // Seed not run yet: create the defaults row (skipDuplicates: two first requests can race).
  await db.settings.createMany({ data: [{ id: 1 }], skipDuplicates: true });
  return db.settings.findUniqueOrThrow({ where: { id: 1 } });
}
