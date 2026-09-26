// Creates and migrates the montage_test database once per test run (needs `docker compose up -d`).
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

export const TEST_DB_URL = "postgres://montage:montage@localhost:5432/montage_test";

export default async function setup() {
  const admin = postgres("postgres://montage:montage@localhost:5432/montage", { max: 1, onnotice: () => {} });
  const [exists] = await admin`select 1 from pg_database where datname = 'montage_test'`;
  if (!exists) await admin`create database montage_test`;
  await admin.end();

  const client = postgres(TEST_DB_URL, { max: 1, onnotice: () => {} });
  await migrate(drizzle(client), { migrationsFolder: "./src/db/migrations" });
  await client.end();
}
