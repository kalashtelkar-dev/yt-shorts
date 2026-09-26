CREATE TYPE "public"."probe_status" AS ENUM('up', 'degraded', 'down', 'not_configured');--> statement-breakpoint
CREATE TABLE "probe_daily" (
	"probe_id" text NOT NULL,
	"day" text NOT NULL,
	"checks" integer DEFAULT 0 NOT NULL,
	"up" integer DEFAULT 0 NOT NULL,
	"degraded" integer DEFAULT 0 NOT NULL,
	"down" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "probe_daily_probe_id_day_pk" PRIMARY KEY("probe_id","day")
);
--> statement-breakpoint
CREATE TABLE "probe_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"probe_id" text NOT NULL,
	"status" "probe_status" NOT NULL,
	"latency_ms" integer,
	"message" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "probe_results_probe_id_checked_at_index" ON "probe_results" USING btree ("probe_id","checked_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "probe_results_checked_at_index" ON "probe_results" USING btree ("checked_at");