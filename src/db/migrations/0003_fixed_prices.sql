UPDATE "jobs" SET "charged_credits" = 0 WHERE "charged_credits" IS NULL;--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "charged_credits" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "charged_credits" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD COLUMN "prices" jsonb DEFAULT '{}'::jsonb NOT NULL;