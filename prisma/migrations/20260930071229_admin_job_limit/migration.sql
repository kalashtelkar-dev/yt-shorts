-- AlterTable
ALTER TABLE "settings" ADD COLUMN     "max_concurrent_jobs_per_admin" INTEGER NOT NULL DEFAULT 3,
ALTER COLUMN "max_concurrent_jobs_per_user" SET DEFAULT 1;
