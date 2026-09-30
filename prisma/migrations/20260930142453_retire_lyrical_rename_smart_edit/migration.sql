-- The user's calls, 2026-09-30 (data only, no schema change):
-- 1. Lyrical Kill Montage is retired: switched off, so it's no longer offered. Its past jobs stay (their credit charges
--    are in the append-only ledger), and its pipelines stay in Engine X.
UPDATE "catalog_items" SET "enabled" = false WHERE "slug" = 'lyrical-kill-montage';

-- 2. Ultra Edit is now Smart Edit, id included: the catalog item and every past job's stored style id.
UPDATE "catalog_items" SET "slug" = 'smart-edit', "title" = 'Smart Edit' WHERE "slug" = 'ultra-edit';
UPDATE "jobs" SET "catalog_slug" = 'smart-edit' WHERE "catalog_slug" = 'ultra-edit';
