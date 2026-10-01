// Rebuilds the test database from the Prisma migrations once per test run (needs `docker compose up -d`).
import { execFileSync } from "node:child_process";
import pg from "pg";

// TEST_DB picks another database name, so parallel runs (e.g. several agents) don't wipe each other's data.
const name = process.env.TEST_DB ?? "montage_test";
if (!/^montage_test\w*$/.test(name)) throw new Error("TEST_DB must start with montage_test");
export const TEST_DB_URL = `postgres://montage:montage@localhost:5432/${name}`;

export default async function setup() {
  const admin = new pg.Client({ connectionString: "postgres://montage:montage@localhost:5432/montage" });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.query(`create database ${name}`);
  await admin.end();
  execFileSync("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: TEST_DB_URL }, stdio: "ignore" });
}
