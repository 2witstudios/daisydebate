ALTER TABLE "entries" ADD COLUMN "submitted_by_user_id" text;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_submitted_by_user_id_users_id_fkey" FOREIGN KEY ("submitted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
-- An unknown historical maker stays unknown; neither approval nor editing may invent one.
CREATE FUNCTION refuse_entry_submitter_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.submitted_by_user_id IS DISTINCT FROM OLD.submitted_by_user_id THEN
    RAISE EXCEPTION 'An entry submitter is immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'entries_submitter_immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER entries_submitter_immutable BEFORE UPDATE OF submitted_by_user_id ON entries
FOR EACH ROW EXECUTE FUNCTION refuse_entry_submitter_change();
