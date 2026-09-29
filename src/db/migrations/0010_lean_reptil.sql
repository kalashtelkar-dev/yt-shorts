CREATE TYPE "public"."payment_status" AS ENUM('created', 'paid', 'failed');--> statement-breakpoint
CREATE TABLE "billing_profiles" (
	"user_id" text PRIMARY KEY NOT NULL,
	"state_code" text NOT NULL,
	"legal_name" text,
	"gstin" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_counters" (
	"fy" integer PRIMARY KEY NOT NULL,
	"last" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"user_id" text NOT NULL,
	"payment_id" uuid NOT NULL,
	"seller" jsonb NOT NULL,
	"buyer" jsonb NOT NULL,
	"credits" integer NOT NULL,
	"taxable_paise" integer NOT NULL,
	"cgst_paise" integer DEFAULT 0 NOT NULL,
	"sgst_paise" integer DEFAULT 0 NOT NULL,
	"igst_paise" integer DEFAULT 0 NOT NULL,
	"total_paise" integer NOT NULL,
	"gst_rate_bps" integer NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_number_unique" UNIQUE("number"),
	CONSTRAINT "invoices_paymentId_unique" UNIQUE("payment_id")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_order_id" text NOT NULL,
	"provider_payment_id" text,
	"amount_paise" integer NOT NULL,
	"credits" integer NOT NULL,
	"status" "payment_status" DEFAULT 'created' NOT NULL,
	"method" text,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "payments_providerOrderId_unique" UNIQUE("provider_order_id"),
	CONSTRAINT "payments_providerPaymentId_unique" UNIQUE("provider_payment_id")
);
--> statement-breakpoint
ALTER TABLE "settings" ALTER COLUMN "cost_paise_per_second" SET DEFAULT 20;--> statement-breakpoint
ALTER TABLE "settings" ALTER COLUMN "sell_paise_per_credit" SET DEFAULT 20;--> statement-breakpoint
UPDATE "settings" SET "sell_paise_per_credit" = 20 WHERE "sell_paise_per_credit" IS NULL;--> statement-breakpoint
ALTER TABLE "settings" ALTER COLUMN "sell_paise_per_credit" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD COLUMN "credit_ranges" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
-- Old fixed prices become the top of each range; the bottom starts at 40% (admins tune both).--> statement-breakpoint
UPDATE "catalog_items" SET "credit_ranges" = COALESCE((
  SELECT jsonb_object_agg(k, jsonb_build_object('min', GREATEST(10, CEIL(v::numeric * 0.04) * 10)::int, 'max', v::int))
  FROM jsonb_each_text("prices") AS p(k, v)
), '{}'::jsonb);--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD COLUMN "payment_id" uuid;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "max_credits" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "min_purchase_paise" integer DEFAULT 10000 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "max_purchase_paise" integer DEFAULT 500000 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "gst_rate_bps" integer DEFAULT 1800 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "seller" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_profiles" ADD CONSTRAINT "billing_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoices_user_id_issued_at_index" ON "invoices" USING btree ("user_id","issued_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "payments_user_id_created_at_index" ON "payments" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "payments_status_created_at_index" ON "payments" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_ledger_payment_id_index" ON "credit_ledger" USING btree ("payment_id") WHERE "credit_ledger"."payment_id" is not null;--> statement-breakpoint
-- Compute now costs ₹0.20 a second; a credit sells for ₹0.20 including GST.
UPDATE "settings" SET "cost_paise_per_second" = 20 WHERE "cost_paise_per_second" = 30;--> statement-breakpoint
UPDATE "settings" SET "seller" = '{"legalName":"Deepsoch AI","address":"3rd Floor, 40, 14th Main Rd, Beside Mc Donald''s, 7th Sector, HSR Layout, Bengaluru, Karnataka 560102, India","stateCode":"29","gstin":"29AALCD7580N1ZQ","pan":"AALCD7580N","email":"support@deepsoch.ai","phone":"+91 98336 52799","website":"https://deepsoch.ai"}'::jsonb WHERE "seller" = '{}'::jsonb;
