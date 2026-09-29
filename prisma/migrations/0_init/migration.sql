-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('user', 'admin');

-- CreateEnum
CREATE TYPE "job_status" AS ENUM ('queued', 'starting', 'running', 'succeeded', 'failed', 'canceled');

-- CreateEnum
CREATE TYPE "job_source" AS ENUM ('url', 'upload');

-- CreateEnum
CREATE TYPE "event_level" AS ENUM ('info', 'warn', 'error');

-- CreateEnum
CREATE TYPE "media_index_kind" AS ENUM ('gameplay', 'song');

-- CreateEnum
CREATE TYPE "media_index_status" AS ENUM ('running', 'succeeded', 'failed');

-- CreateEnum
CREATE TYPE "ledger_kind" AS ENUM ('grant', 'admin_add', 'admin_remove', 'reserve', 'release', 'charge', 'purchase', 'refund', 'transfer');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('created', 'paid', 'failed');

-- CreateEnum
CREATE TYPE "probe_status" AS ENUM ('up', 'degraded', 'down', 'not_configured');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "is_anonymous" BOOLEAN NOT NULL DEFAULT false,
    "role" "user_role" NOT NULL DEFAULT 'user',
    "suspended_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "id_token" TEXT,
    "access_token_expires_at" TIMESTAMPTZ(6),
    "refresh_token_expires_at" TIMESTAMPTZ(6),
    "scope" TEXT,
    "password" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verifications" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "template_id" TEXT NOT NULL,
    "upload_template_id" TEXT,
    "index_templates" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "beta" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "durations" INTEGER[] DEFAULT ARRAY[30, 60, 90]::INTEGER[],
    "fields" JSONB NOT NULL DEFAULT '[]',
    "input_map" JSONB NOT NULL DEFAULT '{}',
    "stage_map" JSONB NOT NULL DEFAULT '[]',
    "output_key" TEXT NOT NULL DEFAULT 'montage',
    "credit_ranges" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_revisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "catalog_item_id" UUID NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changed_by" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" TEXT NOT NULL,
    "catalog_item_id" UUID NOT NULL,
    "catalog_slug" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "template_version" TEXT,
    "index_templates" JSONB,
    "gameplay_index_id" UUID,
    "song_index_id" UUID,
    "phase" TEXT,
    "index_steps" INTEGER NOT NULL DEFAULT 0,
    "input" JSONB NOT NULL,
    "source" "job_source" NOT NULL,
    "source_url" TEXT,
    "upload_key" TEXT,
    "duration_sec" INTEGER NOT NULL,
    "status" "job_status" NOT NULL DEFAULT 'queued',
    "run_id" TEXT,
    "steps_total" INTEGER NOT NULL DEFAULT 0,
    "steps_done" INTEGER NOT NULL DEFAULT 0,
    "current_stage" TEXT,
    "stage_detail" TEXT,
    "retries" INTEGER NOT NULL DEFAULT 0,
    "output_key" TEXT,
    "output_meta" JSONB,
    "error_public" TEXT,
    "error_raw" TEXT,
    "run_ms" INTEGER,
    "charged_credits" INTEGER NOT NULL DEFAULT 0,
    "max_credits" INTEGER NOT NULL DEFAULT 0,
    "compute_cost_paise" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_index" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" "media_index_kind" NOT NULL,
    "cache_key" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "run_id" TEXT,
    "status" "media_index_status" NOT NULL DEFAULT 'running',
    "output" JSONB,
    "steps" JSONB NOT NULL DEFAULT '[]',
    "steps_done" INTEGER NOT NULL DEFAULT 0,
    "steps_total" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "run_ms" INTEGER,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),

    CONSTRAINT "media_index_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_id" UUID NOT NULL,
    "level" "event_level" NOT NULL DEFAULT 'info',
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_ledger" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "kind" "ledger_kind" NOT NULL,
    "job_id" UUID,
    "payment_id" UUID,
    "admin_id" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_balances" (
    "user_id" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_balances_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "cost_paise_per_second" INTEGER NOT NULL DEFAULT 20,
    "sell_paise_per_credit" INTEGER NOT NULL DEFAULT 20,
    "min_purchase_paise" INTEGER NOT NULL DEFAULT 10000,
    "max_purchase_paise" INTEGER NOT NULL DEFAULT 500000,
    "gst_rate_bps" INTEGER NOT NULL DEFAULT 1800,
    "seller" JSONB NOT NULL DEFAULT '{}',
    "starter_credits" INTEGER NOT NULL DEFAULT 600,
    "max_upload_mb" INTEGER NOT NULL DEFAULT 2048,
    "max_concurrent_jobs_per_user" INTEGER NOT NULL DEFAULT 2,
    "max_run_minutes" INTEGER NOT NULL DEFAULT 60,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_order_id" TEXT NOT NULL,
    "provider_payment_id" TEXT,
    "amount_paise" INTEGER NOT NULL,
    "credits" INTEGER NOT NULL,
    "status" "payment_status" NOT NULL DEFAULT 'created',
    "method" TEXT,
    "raw" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMPTZ(6),

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_profiles" (
    "user_id" TEXT NOT NULL,
    "state_code" TEXT NOT NULL,
    "legal_name" TEXT,
    "gstin" TEXT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "number" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "payment_id" UUID NOT NULL,
    "seller" JSONB NOT NULL,
    "buyer" JSONB NOT NULL,
    "credits" INTEGER NOT NULL,
    "taxable_paise" INTEGER NOT NULL,
    "cgst_paise" INTEGER NOT NULL DEFAULT 0,
    "sgst_paise" INTEGER NOT NULL DEFAULT 0,
    "igst_paise" INTEGER NOT NULL DEFAULT 0,
    "total_paise" INTEGER NOT NULL,
    "gst_rate_bps" INTEGER NOT NULL,
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_counters" (
    "fy" INTEGER NOT NULL,
    "last" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "invoice_counters_pkey" PRIMARY KEY ("fy")
);

-- CreateTable
CREATE TABLE "admin_audit_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "admin_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "probe_results" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "probe_id" TEXT NOT NULL,
    "status" "probe_status" NOT NULL,
    "latency_ms" INTEGER,
    "message" TEXT,
    "checked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "probe_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "probe_daily" (
    "probe_id" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "checks" INTEGER NOT NULL DEFAULT 0,
    "up" INTEGER NOT NULL DEFAULT 0,
    "degraded" INTEGER NOT NULL DEFAULT 0,
    "down" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "probe_daily_probe_id_day_pk" PRIMARY KEY ("probe_id","day")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "probe_id" TEXT NOT NULL,
    "severity" "probe_status" NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "resolved_at" TIMESTAMPTZ(6),
    "last_message" TEXT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_unique" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_unique" ON "sessions"("token");

-- CreateIndex
CREATE INDEX "sessions_user_id_index" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "accounts_user_id_index" ON "accounts"("user_id");

-- CreateIndex
CREATE INDEX "verifications_identifier_index" ON "verifications"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_items_slug_unique" ON "catalog_items"("slug");

-- CreateIndex
CREATE INDEX "catalog_revisions_catalog_item_id_created_at_index" ON "catalog_revisions"("catalog_item_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_runId_unique" ON "jobs"("run_id");

-- CreateIndex
CREATE INDEX "jobs_user_id_created_at_index" ON "jobs"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "jobs_status_index" ON "jobs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "media_index_cacheKey_unique" ON "media_index"("cache_key");

-- CreateIndex
CREATE INDEX "media_index_status_index" ON "media_index"("status");

-- CreateIndex
CREATE INDEX "job_events_job_id_created_at_index" ON "job_events"("job_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "credit_ledger_payment_id_index" ON "credit_ledger"("payment_id") WHERE (payment_id IS NOT NULL);

-- CreateIndex
CREATE INDEX "credit_ledger_user_id_created_at_index" ON "credit_ledger"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "credit_ledger_job_id_kind_index" ON "credit_ledger"("job_id", "kind") WHERE (job_id IS NOT NULL);

-- CreateIndex
CREATE UNIQUE INDEX "payments_providerOrderId_unique" ON "payments"("provider_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_providerPaymentId_unique" ON "payments"("provider_payment_id");

-- CreateIndex
CREATE INDEX "payments_user_id_created_at_index" ON "payments"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "payments_status_created_at_index" ON "payments"("status", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "invoices_number_unique" ON "invoices"("number");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_paymentId_unique" ON "invoices"("payment_id");

-- CreateIndex
CREATE INDEX "invoices_user_id_issued_at_index" ON "invoices"("user_id", "issued_at" DESC);

-- CreateIndex
CREATE INDEX "admin_audit_log_created_at_index" ON "admin_audit_log"("created_at" DESC);

-- CreateIndex
CREATE INDEX "probe_results_probe_id_checked_at_index" ON "probe_results"("probe_id", "checked_at" DESC);

-- CreateIndex
CREATE INDEX "probe_results_checked_at_index" ON "probe_results"("checked_at");

-- CreateIndex
CREATE UNIQUE INDEX "incidents_probe_id_index" ON "incidents"("probe_id") WHERE (resolved_at IS NULL);

-- CreateIndex
CREATE INDEX "incidents_started_at_index" ON "incidents"("started_at" DESC);

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "catalog_revisions" ADD CONSTRAINT "catalog_revisions_catalog_item_id_catalog_items_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "catalog_items"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "catalog_revisions" ADD CONSTRAINT "catalog_revisions_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_catalog_item_id_catalog_items_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "catalog_items"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_admin_id_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_balances" ADD CONSTRAINT "user_balances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "billing_profiles" ADD CONSTRAINT "billing_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_admin_id_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;


-- Not expressible in schema.prisma:

-- settings is a single row (id = 1).
ALTER TABLE "settings" ADD CONSTRAINT "settings_single_row" CHECK ("id" = 1);

-- credit_ledger is append-only (CLAUDE.md §5): corrections are new rows, never edits.
CREATE OR REPLACE FUNCTION credit_ledger_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'credit_ledger is append-only (% rejected)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER credit_ledger_no_update_delete
  BEFORE UPDATE OR DELETE ON "credit_ledger"
  FOR EACH ROW EXECUTE FUNCTION credit_ledger_append_only();
