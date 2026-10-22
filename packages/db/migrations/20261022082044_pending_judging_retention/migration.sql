CREATE FUNCTION refuse_pending_judging_erasure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.pending_ballot IS NOT NULL AND EXISTS (SELECT 1 FROM rounds WHERE id=OLD.round_id) THEN
    RAISE EXCEPTION 'A validated pending judging response remains until ballot success or owning Round erasure'
      USING ERRCODE='23514', CONSTRAINT='round_judging_jobs_pending_delete';
  END IF;
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER round_judging_jobs_pending_delete
BEFORE DELETE ON round_judging_jobs
FOR EACH ROW EXECUTE FUNCTION refuse_pending_judging_erasure();
