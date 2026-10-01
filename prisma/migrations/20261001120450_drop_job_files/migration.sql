-- Finished montages now live in the long-term bucket (store-file pipeline, ENGINEX_STORE_*), not in Postgres.
-- Refuses to run while job_files still holds a copy, so a database whose files weren't moved into the bucket loses nothing.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM job_files) THEN
    RAISE EXCEPTION 'job_files still has rows: run files:to-bucket before dropping it';
  END IF;
END $$;

-- DropForeignKey
ALTER TABLE "job_files" DROP CONSTRAINT "job_files_job_id_jobs_id_fk";

-- DropTable
DROP TABLE "job_files";
