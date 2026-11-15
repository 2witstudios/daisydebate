ALTER TABLE "recordings" ADD CONSTRAINT "recordings_tournament_deadline_shape" CHECK (coalesce("eligibility"->>'kind'<>'tournament_admission' or jsonb_typeof("eligibility"->'deadlineAt')='string',false));--> statement-breakpoint
-- The immutable Recording pin must name the actual finite obligation, not merely a real admission id.
CREATE FUNCTION public.daisy_recording_admission_deadline() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NEW.eligibility->>'kind'='tournament_admission' AND NOT EXISTS (
  SELECT 1 FROM public.tournament_capture_admissions a
  WHERE a.id=(NEW.eligibility->>'admissionId') AND a.round_id=NEW.round_id
   AND isfinite((NEW.eligibility->>'deadlineAt')::timestamptz)
   AND a.deadline_at=(NEW.eligibility->>'deadlineAt')::timestamptz
 ) THEN
  RAISE EXCEPTION 'Recording deadline must match its actual admission'
   USING ERRCODE='23514',CONSTRAINT='recordings_admission_deadline';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_recording_admission_deadline() FROM PUBLIC,daisy_web;
--> statement-breakpoint
CREATE TRIGGER recordings_admission_deadline BEFORE INSERT ON public.recordings
 FOR EACH ROW EXECUTE FUNCTION public.daisy_recording_admission_deadline();
