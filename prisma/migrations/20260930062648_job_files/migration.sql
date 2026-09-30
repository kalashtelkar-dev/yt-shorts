-- CreateTable
CREATE TABLE "job_files" (
    "job_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_files_pkey" PRIMARY KEY ("job_id","kind")
);

-- AddForeignKey
ALTER TABLE "job_files" ADD CONSTRAINT "job_files_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- Videos are already compressed: store them as-is, so substring() on a byte range reads only the chunks it needs.
ALTER TABLE "job_files" ALTER COLUMN "data" SET STORAGE EXTERNAL;
