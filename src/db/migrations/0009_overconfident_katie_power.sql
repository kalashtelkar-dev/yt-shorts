CREATE TYPE "public"."media_index_kind" AS ENUM('gameplay', 'song');--> statement-breakpoint
CREATE TYPE "public"."media_index_status" AS ENUM('running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "media_index" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "media_index_kind" NOT NULL,
	"cache_key" text NOT NULL,
	"template_id" text NOT NULL,
	"input" jsonb NOT NULL,
	"run_id" text,
	"status" "media_index_status" DEFAULT 'running' NOT NULL,
	"output" jsonb,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"steps_done" integer DEFAULT 0 NOT NULL,
	"steps_total" integer DEFAULT 0 NOT NULL,
	"error" text,
	"run_ms" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "media_index_cacheKey_unique" UNIQUE("cache_key")
);
--> statement-breakpoint
ALTER TABLE "catalog_items" ADD COLUMN "index_templates" jsonb;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "index_templates" jsonb;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "gameplay_index_id" uuid;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "song_index_id" uuid;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "phase" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "index_steps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "media_index_status_index" ON "media_index" USING btree ("status");