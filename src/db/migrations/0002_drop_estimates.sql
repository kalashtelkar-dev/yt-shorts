DROP INDEX "jobs_catalog_item_id_duration_sec_finished_at_index";--> statement-breakpoint
ALTER TABLE "catalog_items" DROP COLUMN "default_estimate_sec";--> statement-breakpoint
ALTER TABLE "jobs" DROP COLUMN "reserved_credits";--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN "ms_per_credit";