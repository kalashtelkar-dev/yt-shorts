import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { settings } from "@/db/schema";

export type Settings = typeof settings.$inferSelect;

export async function getSettings(): Promise<Settings> {
  const [row] = await db.select().from(settings).where(eq(settings.id, 1));
  if (row) return row;
  // Seed not run yet: create the defaults row.
  const [created] = await db.insert(settings).values({ id: 1 }).onConflictDoNothing().returning();
  return created ?? (await getSettings());
}
