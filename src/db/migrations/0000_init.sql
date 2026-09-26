CREATE TYPE "public"."event_level" AS ENUM('info', 'warn', 'error');--> statement-breakpoint
CREATE TYPE "public"."job_source" AS ENUM('url', 'upload');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'starting', 'running', 'succeeded', 'failed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."ledger_kind" AS ENUM('grant', 'admin_add', 'admin_remove', 'reserve', 'release', 'charge', 'purchase', 'refund');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" text NOT NULL,
	"action" text NOT NULL,
	"target" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"template_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"beta" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"durations" integer[] DEFAULT '{30,60,90}'::integer[] NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"input_map" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"stage_map" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"output_key" text DEFAULT 'montage' NOT NULL,
	"default_estimate_sec" integer DEFAULT 900 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_items_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "catalog_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"catalog_item_id" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	"changed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"delta" integer NOT NULL,
	"kind" "ledger_kind" NOT NULL,
	"job_id" uuid,
	"admin_id" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"level" "event_level" DEFAULT 'info' NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"catalog_item_id" uuid NOT NULL,
	"catalog_slug" text NOT NULL,
	"template_id" text NOT NULL,
	"template_version" text,
	"input" jsonb NOT NULL,
	"source" "job_source" NOT NULL,
	"source_url" text,
	"upload_key" text,
	"duration_sec" integer NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"run_id" text,
	"steps_total" integer DEFAULT 0 NOT NULL,
	"steps_done" integer DEFAULT 0 NOT NULL,
	"current_stage" text,
	"output_key" text,
	"output_meta" jsonb,
	"error_public" text,
	"error_raw" text,
	"run_ms" integer,
	"reserved_credits" integer DEFAULT 0 NOT NULL,
	"charged_credits" integer,
	"compute_cost_paise" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "jobs_runId_unique" UNIQUE("run_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"cost_paise_per_second" integer DEFAULT 30 NOT NULL,
	"ms_per_credit" integer DEFAULT 1000 NOT NULL,
	"sell_paise_per_credit" integer,
	"starter_credits" integer DEFAULT 600 NOT NULL,
	"max_upload_mb" integer DEFAULT 2048 NOT NULL,
	"max_concurrent_jobs_per_user" integer DEFAULT 2 NOT NULL,
	"max_run_minutes" integer DEFAULT 60 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_single_row" CHECK ("settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "user_balances" (
	"user_id" text PRIMARY KEY NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"is_anonymous" boolean DEFAULT false NOT NULL,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"suspended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_admin_id_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_revisions" ADD CONSTRAINT "catalog_revisions_catalog_item_id_catalog_items_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."catalog_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_revisions" ADD CONSTRAINT "catalog_revisions_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_admin_id_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_catalog_item_id_catalog_items_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."catalog_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_balances" ADD CONSTRAINT "user_balances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_id_index" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "admin_audit_log_created_at_index" ON "admin_audit_log" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "catalog_revisions_catalog_item_id_created_at_index" ON "catalog_revisions" USING btree ("catalog_item_id","created_at");--> statement-breakpoint
CREATE INDEX "credit_ledger_user_id_created_at_index" ON "credit_ledger" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_ledger_job_id_kind_index" ON "credit_ledger" USING btree ("job_id","kind") WHERE "credit_ledger"."job_id" is not null;--> statement-breakpoint
CREATE INDEX "job_events_job_id_created_at_index" ON "job_events" USING btree ("job_id","created_at");--> statement-breakpoint
CREATE INDEX "jobs_user_id_created_at_index" ON "jobs" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "jobs_status_index" ON "jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "jobs_catalog_item_id_duration_sec_finished_at_index" ON "jobs" USING btree ("catalog_item_id","duration_sec","finished_at" DESC NULLS LAST) WHERE "jobs"."status" = 'succeeded';--> statement-breakpoint
CREATE INDEX "sessions_user_id_index" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verifications_identifier_index" ON "verifications" USING btree ("identifier");