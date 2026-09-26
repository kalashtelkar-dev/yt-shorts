ALTER TABLE "jobs" ADD COLUMN "stage_detail" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "retries" integer DEFAULT 0 NOT NULL;