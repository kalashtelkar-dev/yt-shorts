import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { Probe } from "../types";

export const postgresProbe: Probe = {
  id: "postgres",
  name: "PostgreSQL",
  tier: "data",
  critical: true,
  degradedMs: 250,
  async run() {
    await db.execute(sql`select 1`);
    return { status: "up" };
  },
};
