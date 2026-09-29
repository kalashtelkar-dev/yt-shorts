import "server-only";
import { db } from "@/db/client";
import type { Probe } from "../types";

export const postgresProbe: Probe = {
  id: "postgres",
  name: "PostgreSQL",
  tier: "data",
  critical: true,
  degradedMs: 250,
  async run() {
    await db.$queryRaw`select 1`;
    return { status: "up" };
  },
};
