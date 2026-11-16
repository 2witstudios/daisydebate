-- Terminal competitive state is absorbing. A release based on it cannot be reopened.
CREATE FUNCTION public.daisy_round_terminal_status() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF OLD.status IN ('completed','abandoned') AND NEW.status IS DISTINCT FROM OLD.status THEN
  RAISE EXCEPTION 'A terminal Round cannot reopen or change its ending kind'
   USING ERRCODE='23514',CONSTRAINT='rounds_terminal_status';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_round_terminal_status() FROM PUBLIC,daisy_web;
--> statement-breakpoint
CREATE TRIGGER rounds_terminal_status BEFORE UPDATE OF status ON public.rounds
 FOR EACH ROW EXECUTE FUNCTION public.daisy_round_terminal_status();
--> statement-breakpoint
-- Every Recording over an admitted Round, including a direct INSERT, takes the
-- same admission fence. An alternative eligibility kind cannot evade settlement.
CREATE OR REPLACE FUNCTION public.daisy_recording_admission_deadline() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE admission public.tournament_capture_admissions%ROWTYPE;
BEGIN
 SELECT * INTO admission FROM public.tournament_capture_admissions WHERE round_id=NEW.round_id FOR UPDATE;
 IF FOUND THEN
  IF admission.settled_at IS NOT NULL OR NOT coalesce(
   NEW.eligibility->>'kind'='tournament_admission'
   AND NEW.eligibility->>'admissionId'=admission.id
   AND jsonb_typeof(NEW.eligibility->'deadlineAt')='string'
   AND isfinite((NEW.eligibility->>'deadlineAt')::timestamptz)
   AND (NEW.eligibility->>'deadlineAt')::timestamptz=admission.deadline_at,false)
  THEN
   RAISE EXCEPTION 'Recording must name its actual open admission'
    USING ERRCODE='23514',CONSTRAINT='recordings_admission_deadline';
  END IF;
 ELSIF NEW.eligibility->>'kind'='tournament_admission' THEN
  RAISE EXCEPTION 'Recording admission does not exist'
   USING ERRCODE='23514',CONSTRAINT='recordings_admission_deadline';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.daisy_recording_settle_undispatched_tournament_admission(target_round_id text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE admission public.tournament_capture_admissions%ROWTYPE;
BEGIN
 SELECT * INTO admission FROM public.tournament_capture_admissions WHERE round_id=target_round_id FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF admission.settled_at IS NOT NULL THEN RETURN true; END IF;
 -- No child resource exists, the Round is irreversibly terminal, and the
 -- admission fence prevents any later request or dispatch from using it.
 IF EXISTS(SELECT 1 FROM public.rounds WHERE id=target_round_id AND status IN ('completed','abandoned'))
  AND NOT EXISTS(SELECT 1 FROM public.recordings WHERE round_id=target_round_id)
  AND NOT EXISTS(SELECT 1 FROM public.recording_captures WHERE round_id=target_round_id)
  AND NOT EXISTS(SELECT 1 FROM public.broadcasts WHERE round_id=target_round_id)
 THEN
  UPDATE public.tournament_capture_admissions SET settled_at=clock_timestamp() WHERE id=admission.id;
  RETURN true;
 END IF;
 -- Existing deadline cleanup remains separate from terminal zero-work release.
 IF clock_timestamp()<admission.deadline_at OR EXISTS(
  SELECT 1 FROM public.recording_captures c WHERE c.round_id=target_round_id
   AND (c.egress_dispatched_at IS NOT NULL OR c.egress_id IS NOT NULL)
 ) THEN RETURN false; END IF;
 UPDATE public.tournament_capture_admissions SET settled_at=clock_timestamp() WHERE id=admission.id;
 RETURN true;
END;
$$;
