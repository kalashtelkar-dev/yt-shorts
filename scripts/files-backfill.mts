// pnpm files:backfill — copies the video and cover of every finished job that isn't saved in Postgres yet
// (jobs from before job_files). Files Engine X has already cleared are reported, not retried.
import { db } from "@/db/client";
import { saveMissingFiles } from "@/server/jobs/files";

const r = await saveMissingFiles({ since: new Date(0), limit: 10_000 });
for (const f of r.failed) console.log(`  job ${f.id}: ${f.error}`);
console.log(`Saved ${r.tried - r.failed.length} of ${r.tried} jobs' files${r.failed.length ? `; ${r.failed.length} couldn't be fetched (listed above)` : ""}.`);
await db.$disconnect();
