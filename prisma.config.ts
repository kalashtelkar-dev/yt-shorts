import { defineConfig } from "prisma/config";

// The Prisma CLI doesn't read .env on its own; the app reads env through src/config/env.ts.
try {
  process.loadEnvFile();
} catch {}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx --conditions=react-server src/db/seed.mts" },
  datasource: { url: process.env.DATABASE_URL ?? "postgres://montage:montage@localhost:5432/montage" },
});
