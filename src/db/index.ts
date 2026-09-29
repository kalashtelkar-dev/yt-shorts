import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/config/env";
import * as schema from "./schema";

// One pool per process. Cached on globalThis so dev hot reloads reuse it instead of opening another
// 10 connections each time (which ran Postgres out of connections).
const g = globalThis as unknown as { pg?: ReturnType<typeof postgres> };
const client = (g.pg ??= postgres(env.DATABASE_URL, { max: 10 }));

export const db = drizzle(client, { schema, casing: "snake_case" });
