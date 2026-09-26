-- credit_ledger is append-only (CLAUDE.md §5): corrections are new rows, never edits.
CREATE OR REPLACE FUNCTION credit_ledger_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'credit_ledger is append-only (% rejected)', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER credit_ledger_no_update_delete
  BEFORE UPDATE OR DELETE ON credit_ledger
  FOR EACH ROW EXECUTE FUNCTION credit_ledger_append_only();
