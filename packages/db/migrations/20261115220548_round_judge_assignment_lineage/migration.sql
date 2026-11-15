CREATE TABLE "round_finalization_judge_assignments" (
	"round_id" text,
	"slot" integer,
	"assignment_version" integer,
	"participant_id" text,
	CONSTRAINT "round_finalization_judge_assignments_pkey" PRIMARY KEY("round_id","slot"),
	CONSTRAINT "round_finalization_judge_assignments_participant_unique" UNIQUE("round_id","participant_id"),
	CONSTRAINT "round_finalization_judge_assignments_slot_check" CHECK ("slot">=0 and ("assignment_version" is null or "assignment_version">0) and ("assignment_version" is not null or "participant_id" is null))
);
--> statement-breakpoint
CREATE TABLE "round_judge_assignments" (
	"round_id" text,
	"slot" integer,
	"version" integer,
	"previous_version" integer GENERATED ALWAYS AS (case when version>1 then version-1 else null end) STORED,
	"participant_id" text,
	"actor_id" text,
	"source" text NOT NULL,
	"command_id" text,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "round_judge_assignments_pkey" PRIMARY KEY("round_id","slot","version"),
	CONSTRAINT "round_judge_assignments_occupant_unique" UNIQUE("round_id","slot","version","participant_id","actor_id"),
	CONSTRAINT "round_judge_assignments_participant_unique" UNIQUE("round_id","slot","version","participant_id"),
	CONSTRAINT "round_judge_assignments_version_check" CHECK ("slot">=0 and "version">0),
	CONSTRAINT "round_judge_assignments_occupant_check" CHECK (("participant_id" is null)=("actor_id" is null)),
	CONSTRAINT "round_judge_assignments_source_check" CHECK ("source" in ('initial','observed','command') and ("command_id" is not null)=("source"='command') and ("source"='command' or "version"=1) and isfinite("recorded_at"))
);
--> statement-breakpoint
CREATE TABLE "round_judge_slots" (
	"round_id" text,
	"slot" integer,
	"current_version" integer,
	"participant_id" text,
	"actor_id" text,
	CONSTRAINT "round_judge_slots_pkey" PRIMARY KEY("round_id","slot"),
	CONSTRAINT "round_judge_slots_slot_check" CHECK ("slot">=0),
	CONSTRAINT "round_judge_slots_version_check" CHECK ("current_version" is null or "current_version">0),
	CONSTRAINT "round_judge_slots_occupant_check" CHECK (("participant_id" is null)=("actor_id" is null) and ("current_version" is not null or "participant_id" is null))
);
--> statement-breakpoint
CREATE TABLE "round_source_voids" (
	"round_id" text PRIMARY KEY,
	"command_id" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "round_source_voids_time_check" CHECK (isfinite("recorded_at"))
);
--> statement-breakpoint
ALTER TABLE "round_participants" DROP CONSTRAINT "round_participants_seat_unique";--> statement-breakpoint
ALTER TABLE "rating_changes" DROP CONSTRAINT "rating_changes_participant_fk";--> statement-breakpoint
DROP INDEX "round_participants_actor_unique";--> statement-breakpoint
ALTER TABLE "round_participants" ADD COLUMN "rating_actor_id" text GENERATED ALWAYS AS (case when seat_kind in ('side','speaker') then actor_id else null end) STORED;--> statement-breakpoint
ALTER TABLE "round_participants" ADD CONSTRAINT "round_participants_assignment_identity_unique" UNIQUE("id","round_id","slot","actor_id");--> statement-breakpoint
CREATE INDEX "round_finalization_judge_assignments_version_idx" ON "round_finalization_judge_assignments" ("round_id","slot","assignment_version","participant_id");--> statement-breakpoint
CREATE INDEX "round_judge_assignments_participant_idx" ON "round_judge_assignments" ("participant_id","round_id","slot","actor_id");--> statement-breakpoint
CREATE INDEX "round_judge_assignments_previous_idx" ON "round_judge_assignments" ("round_id","slot","previous_version");--> statement-breakpoint
CREATE INDEX "round_judge_assignments_actor_idx" ON "round_judge_assignments" ("actor_id","round_id");--> statement-breakpoint
CREATE INDEX "round_judge_assignments_command_idx" ON "round_judge_assignments" ("command_id","round_id");--> statement-breakpoint
CREATE INDEX "round_judge_slots_assignment_idx" ON "round_judge_slots" ("round_id","slot","current_version","participant_id","actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "round_judge_slots_current_actor_unique" ON "round_judge_slots" ("round_id","actor_id") WHERE "actor_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "round_judge_slots_current_participant_unique" ON "round_judge_slots" ("participant_id") WHERE "participant_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "round_participants_fixed_actor_unique" ON "round_participants" ("round_id","actor_id") WHERE "seat_kind"<>'judge';--> statement-breakpoint
CREATE UNIQUE INDEX "round_participants_rating_actor_unique" ON "round_participants" ("round_id","rating_actor_id");--> statement-breakpoint
CREATE INDEX "round_participants_round_actor_idx" ON "round_participants" ("round_id","actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "round_participants_fixed_seat_unique" ON "round_participants" ("round_id","seat_kind",coalesce("side",''),"slot") WHERE "seat_kind"<>'judge';--> statement-breakpoint
CREATE INDEX "round_source_voids_command_idx" ON "round_source_voids" ("command_id","round_id");--> statement-breakpoint
ALTER TABLE "round_finalization_judge_assignments" ADD CONSTRAINT "round_finalization_judge_assignments_0bD8W7xwSyhz_fkey" FOREIGN KEY ("round_id") REFERENCES "round_finalizations"("round_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "round_finalization_judge_assignments" ADD CONSTRAINT "round_finalization_judge_assignments_version_fk" FOREIGN KEY ("round_id","slot","assignment_version") REFERENCES "round_judge_assignments"("round_id","slot","version");--> statement-breakpoint
ALTER TABLE "round_finalization_judge_assignments" ADD CONSTRAINT "round_finalization_judge_assignments_occupant_fk" FOREIGN KEY ("round_id","slot","assignment_version","participant_id") REFERENCES "round_judge_assignments"("round_id","slot","version","participant_id");--> statement-breakpoint
ALTER TABLE "round_judge_assignments" ADD CONSTRAINT "round_judge_assignments_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "round_judge_assignments" ADD CONSTRAINT "round_judge_assignments_slot_fk" FOREIGN KEY ("round_id","slot") REFERENCES "round_judge_slots"("round_id","slot") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "round_judge_assignments" ADD CONSTRAINT "round_judge_assignments_previous_fk" FOREIGN KEY ("round_id","slot","previous_version") REFERENCES "round_judge_assignments"("round_id","slot","version");--> statement-breakpoint
ALTER TABLE "round_judge_assignments" ADD CONSTRAINT "round_judge_assignments_identity_fk" FOREIGN KEY ("participant_id","round_id","slot","actor_id") REFERENCES "round_participants"("id","round_id","slot","actor_id");--> statement-breakpoint
ALTER TABLE "round_judge_assignments" ADD CONSTRAINT "round_judge_assignments_command_fk" FOREIGN KEY ("command_id","round_id") REFERENCES "round_commands"("command_id","round_id");--> statement-breakpoint
ALTER TABLE "round_judge_slots" ADD CONSTRAINT "round_judge_slots_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "round_judge_slots" ADD CONSTRAINT "round_judge_slots_assignment_fk" FOREIGN KEY ("round_id","slot","current_version") REFERENCES "round_judge_assignments"("round_id","slot","version");--> statement-breakpoint
ALTER TABLE "round_judge_slots" ADD CONSTRAINT "round_judge_slots_occupant_fk" FOREIGN KEY ("round_id","slot","current_version","participant_id","actor_id") REFERENCES "round_judge_assignments"("round_id","slot","version","participant_id","actor_id");--> statement-breakpoint
ALTER TABLE "round_source_voids" ADD CONSTRAINT "round_source_voids_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "round_source_voids" ADD CONSTRAINT "round_source_voids_command_fk" FOREIGN KEY ("command_id","round_id") REFERENCES "round_commands"("command_id","round_id");--> statement-breakpoint
ALTER TABLE "rating_changes" ADD CONSTRAINT "rating_changes_participant_fk" FOREIGN KEY ("round_id","actor_id") REFERENCES "round_participants"("round_id","rating_actor_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "round_commands" DROP CONSTRAINT "round_commands_type_check", ADD CONSTRAINT "round_commands_type_check" CHECK ("type" in ('start', 'strike_resolution', 'start_prep', 'start_speech', 'yield', 'interrupt', 'forfeit', 'leave', 'complete', 'submit_ballot', 'change_judge', 'stop', 'void_source', 'check_in', 'adjudicate'));--> statement-breakpoint
ALTER TABLE "round_judging_jobs" DROP CONSTRAINT "round_judging_jobs_terminal_reason_check", ADD CONSTRAINT "round_judging_jobs_terminal_reason_check" CHECK (("status" = 'failed') = ("terminal_reason" is not null) and ("terminal_reason" is null or "terminal_reason" in ('assignment_retired', 'attempts_exhausted', 'ballot_discarded', 'ballot_hold_ended', 'generation_deadline', 'provider_refused', 'round_ended')));
--> statement-breakpoint
-- Room Start may construct an already-active Round. Only its actual creating transaction
-- may populate that cast; later identities use the ordinary assignment command.
CREATE FUNCTION public.daisy_round_is_being_constructed(target_round_id text) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT coalesce((SELECT r.version=1 AND (
   r.room_id IS NULL AND r.status='opening' OR
   r.status IN ('opening','active') AND r.xmin=pg_current_xact_id()::xid
 ) FROM public.rounds r WHERE r.id=target_round_id),false);
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_round_is_being_constructed(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_round_is_being_constructed(text) TO daisy_web;
--> statement-breakpoint
-- Frozen slot cardinality is the original ordinary execution grammar, never the current head count.
CREATE FUNCTION public.daisy_round_judge_slot_count(rules jsonb) RETURNS integer
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE raw text:=rules#>>'{seats,judges}';
BEGIN
 IF raw IS NULL OR raw !~ '^(0|[1-9][0-9]{0,2})$' THEN
  RAISE EXCEPTION 'Invalid frozen judge slot count' USING ERRCODE='23514',CONSTRAINT='round_judge_slots_frozen_count';
 END IF;
 IF raw::integer>256 THEN
  RAISE EXCEPTION 'Invalid frozen judge slot count' USING ERRCODE='23514',CONSTRAINT='round_judge_slots_frozen_count';
 END IF;
 RETURN raw::integer;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_round_judge_slot_count(jsonb) FROM PUBLIC;
--> statement-breakpoint
-- Only actual pre-existing relationships are observed. No previous command or assignment instant is inferred.
INSERT INTO public.round_judge_slots(round_id,slot)
 SELECT r.id,n FROM public.rounds r CROSS JOIN LATERAL generate_series(0,public.daisy_round_judge_slot_count(r.rules_snapshot)-1) n;
--> statement-breakpoint
INSERT INTO public.round_judge_assignments(round_id,slot,version,participant_id,actor_id,source,recorded_at)
 SELECT p.round_id,p.slot,1,p.id,p.actor_id,'observed',clock_timestamp()
 FROM public.round_participants p WHERE p.seat_kind='judge';
--> statement-breakpoint
UPDATE public.round_judge_slots s SET current_version=1,participant_id=a.participant_id,actor_id=a.actor_id
 FROM public.round_judge_assignments a WHERE a.round_id=s.round_id AND a.slot=s.slot AND a.version=1;
--> statement-breakpoint
INSERT INTO public.round_finalization_judge_assignments(round_id,slot,assignment_version,participant_id)
 SELECT s.round_id,s.slot,s.current_version,s.participant_id FROM public.round_judge_slots s
 JOIN public.round_finalizations f ON f.round_id=s.round_id;
--> statement-breakpoint
REVOKE INSERT,UPDATE,DELETE ON public.round_judge_slots,public.round_judge_assignments,
 public.round_finalization_judge_assignments,public.round_source_voids FROM daisy_web;
--> statement-breakpoint
CREATE FUNCTION public.daisy_round_assignment_history_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM public.rounds WHERE id=OLD.round_id) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Round assignment history is immutable' USING ERRCODE='23514',CONSTRAINT='round_assignment_history_immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER round_judge_assignments_immutable BEFORE UPDATE OR DELETE ON public.round_judge_assignments
 FOR EACH ROW EXECUTE FUNCTION public.daisy_round_assignment_history_immutable();
--> statement-breakpoint
CREATE TRIGGER round_finalization_judge_assignments_immutable BEFORE UPDATE OR DELETE ON public.round_finalization_judge_assignments
 FOR EACH ROW EXECUTE FUNCTION public.daisy_round_assignment_history_immutable();
--> statement-breakpoint
CREATE TRIGGER round_source_voids_immutable BEFORE UPDATE OR DELETE ON public.round_source_voids
 FOR EACH ROW EXECUTE FUNCTION public.daisy_round_assignment_history_immutable();
--> statement-breakpoint
CREATE FUNCTION public.daisy_round_judge_slots_freeze() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  INSERT INTO public.round_judge_slots(round_id,slot)
   SELECT NEW.id,n FROM generate_series(0,public.daisy_round_judge_slot_count(NEW.rules_snapshot)-1) n;
 ELSIF public.daisy_round_judge_slot_count(NEW.rules_snapshot)<>public.daisy_round_judge_slot_count(OLD.rules_snapshot) THEN
  RAISE EXCEPTION 'Judge slot cardinality froze at Start' USING ERRCODE='23514',CONSTRAINT='round_judge_slots_frozen_count';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_round_judge_slots_freeze() FROM PUBLIC,daisy_web;
--> statement-breakpoint
CREATE TRIGGER rounds_freeze_judge_slots AFTER INSERT OR UPDATE OF rules_snapshot ON public.rounds
 FOR EACH ROW EXECUTE FUNCTION public.daisy_round_judge_slots_freeze();
--> statement-breakpoint
CREATE FUNCTION public.daisy_round_participant_identity_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE parent public.rounds%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN
  IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM public.rounds WHERE id=OLD.round_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'A Round participant identity cannot be rewritten' USING ERRCODE='23514',CONSTRAINT='round_participants_identity_immutable';
 END IF;
 SELECT * INTO parent FROM public.rounds WHERE id=NEW.round_id FOR NO KEY UPDATE;
 IF NOT FOUND THEN RETURN NEW; END IF; -- The actual owning FK supplies the refusal.
 IF NEW.seat_kind<>'judge' AND NOT public.daisy_round_is_being_constructed(NEW.round_id) THEN
  RAISE EXCEPTION 'Non-judge cast froze at Start' USING ERRCODE='23514',CONSTRAINT='round_participants_fixed_cast';
 END IF;
 IF NEW.seat_kind='judge' AND NOT EXISTS(SELECT 1 FROM public.round_judge_slots WHERE round_id=NEW.round_id AND slot=NEW.slot) THEN
  RAISE EXCEPTION 'A judge needs an original frozen slot' USING ERRCODE='23514',CONSTRAINT='round_judge_assignment_slot';
 END IF;
 IF NEW.seat_kind='judge' AND EXISTS(SELECT 1 FROM public.round_participants p
   WHERE p.round_id=NEW.round_id AND p.actor_id=NEW.actor_id AND p.seat_kind<>'judge') OR
  NEW.seat_kind<>'judge' AND EXISTS(SELECT 1 FROM public.round_judge_slots s WHERE s.round_id=NEW.round_id AND s.actor_id=NEW.actor_id) THEN
  RAISE EXCEPTION 'One current seat per actor' USING ERRCODE='23514',CONSTRAINT='round_participants_current_actor';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER round_participants_identity_guard BEFORE INSERT OR UPDATE OR DELETE ON public.round_participants
 FOR EACH ROW EXECUTE FUNCTION public.daisy_round_participant_identity_guard();
--> statement-breakpoint
CREATE FUNCTION public.daisy_round_judge_assignment_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE parent public.rounds%ROWTYPE; current_slot public.round_judge_slots%ROWTYPE;
 identity public.round_participants%ROWTYPE; receipt public.round_commands%ROWTYPE;
BEGIN
 SELECT * INTO parent FROM public.rounds WHERE id=NEW.round_id FOR NO KEY UPDATE;
 SELECT * INTO current_slot FROM public.round_judge_slots WHERE round_id=NEW.round_id AND slot=NEW.slot FOR UPDATE;
 IF NOT FOUND OR NEW.version<>coalesce(current_slot.current_version,0)+1 THEN
  RAISE EXCEPTION 'Assignment must extend its actual slot' USING ERRCODE='23514',CONSTRAINT='round_judge_assignment_version';
 END IF;
 IF current_slot.participant_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.ballots WHERE judge_participant_id=current_slot.participant_id) THEN
  RAISE EXCEPTION 'A submitted assignment cannot retire' USING ERRCODE='23514',CONSTRAINT='round_judge_assignment_submitted';
 END IF;
 IF NEW.participant_id IS NOT NULL THEN
  IF EXISTS(SELECT 1 FROM public.round_judge_assignments WHERE participant_id=NEW.participant_id) THEN
   RAISE EXCEPTION 'A retired assignment identity cannot become current again' USING ERRCODE='23514',CONSTRAINT='round_judge_assignment_identity_reused';
  END IF;
  SELECT * INTO identity FROM public.round_participants WHERE id=NEW.participant_id;
  IF NOT FOUND OR identity.round_id<>NEW.round_id OR identity.seat_kind<>'judge' OR identity.slot<>NEW.slot OR identity.actor_id<>NEW.actor_id THEN
   RAISE EXCEPTION 'Assignment needs its actual judge identity' USING ERRCODE='23514',CONSTRAINT='round_judge_assignment_identity';
  END IF;
 END IF;
 IF NEW.source='initial' THEN
  IF NOT public.daisy_round_is_being_constructed(NEW.round_id) OR NEW.version<>1 OR NEW.participant_id IS NULL OR NEW.recorded_at<parent.created_at OR NEW.recorded_at>clock_timestamp() THEN
   RAISE EXCEPTION 'Initial assignment differs from construction' USING ERRCODE='23514',CONSTRAINT='round_judge_assignment_start';
  END IF;
 ELSIF NEW.source='command' THEN
  SELECT * INTO receipt FROM public.round_commands WHERE command_id=NEW.command_id AND round_id=NEW.round_id;
  IF parent.status NOT IN ('opening','active') OR EXISTS(SELECT 1 FROM public.round_source_voids WHERE round_id=NEW.round_id)
   OR NOT coalesce(receipt.type='change_judge' AND receipt.resulting_version=parent.version+1
    AND receipt.result->>'kind'='judge_assignment' AND receipt.result->>'roundId'=NEW.round_id
    AND (receipt.result->>'slot')::integer=NEW.slot AND (receipt.result->>'assignmentVersion')::integer=NEW.version
    AND receipt.result->'participantId'=coalesce(to_jsonb(NEW.participant_id),'null'::jsonb)
    AND receipt.applied_at=NEW.recorded_at,false) THEN
   RAISE EXCEPTION 'Assignment needs a current ordinary command' USING ERRCODE='23514',CONSTRAINT='round_judge_assignment_command';
  END IF;
  IF current_slot.participant_id IS NOT DISTINCT FROM NEW.participant_id THEN
   RAISE EXCEPTION 'Assignment must change its occupant' USING ERRCODE='23514',CONSTRAINT='round_judge_assignment_unchanged';
  END IF;
 ELSE
  RAISE EXCEPTION 'Old assignment history cannot be manufactured' USING ERRCODE='23514',CONSTRAINT='round_judge_assignment_source';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER round_judge_assignment_guard BEFORE INSERT ON public.round_judge_assignments
 FOR EACH ROW EXECUTE FUNCTION public.daisy_round_judge_assignment_guard();
--> statement-breakpoint
CREATE FUNCTION public.daisy_round_judge_slot_pointer() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 UPDATE public.round_judge_slots SET current_version=NEW.version,participant_id=NEW.participant_id,actor_id=NEW.actor_id
 WHERE round_id=NEW.round_id AND slot=NEW.slot;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_round_judge_slot_pointer() FROM PUBLIC,daisy_web;
--> statement-breakpoint
CREATE TRIGGER round_judge_assignment_pointer AFTER INSERT ON public.round_judge_assignments
 FOR EACH ROW EXECUTE FUNCTION public.daisy_round_judge_slot_pointer();
--> statement-breakpoint
CREATE FUNCTION public.daisy_round_initial_judge_assignment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE parent public.rounds%ROWTYPE;
BEGIN
 SELECT * INTO parent FROM public.rounds WHERE id=NEW.round_id FOR NO KEY UPDATE;
 IF NEW.seat_kind='judge' AND public.daisy_round_is_being_constructed(NEW.round_id) AND EXISTS(
  SELECT 1 FROM public.round_judge_slots WHERE round_id=NEW.round_id AND slot=NEW.slot AND current_version IS NULL
 ) THEN
  INSERT INTO public.round_judge_assignments(round_id,slot,version,participant_id,actor_id,source,recorded_at)
  VALUES(NEW.round_id,NEW.slot,1,NEW.id,NEW.actor_id,'initial',clock_timestamp());
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_round_initial_judge_assignment() FROM PUBLIC,daisy_web;
--> statement-breakpoint
CREATE TRIGGER round_participants_initial_judge_assignment AFTER INSERT ON public.round_participants
 FOR EACH ROW EXECUTE FUNCTION public.daisy_round_initial_judge_assignment();
--> statement-breakpoint
CREATE FUNCTION public.daisy_round_judge_identity_assigned() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.round_participants WHERE id=NEW.id) AND NOT EXISTS(
  SELECT 1 FROM public.round_judge_assignments WHERE participant_id=NEW.id AND round_id=NEW.round_id
 ) THEN
  RAISE EXCEPTION 'A new judge identity must be assigned in its transaction' USING ERRCODE='23514',CONSTRAINT='round_judge_identity_assigned';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER round_judge_identity_assigned AFTER INSERT ON public.round_participants
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.seat_kind='judge')
 EXECUTE FUNCTION public.daisy_round_judge_identity_assigned();
--> statement-breakpoint
CREATE FUNCTION public.daisy_round_participant_is_current(target_participant_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.round_participants p WHERE p.id=target_participant_id AND (
  p.seat_kind<>'judge' OR EXISTS(SELECT 1 FROM public.round_judge_slots s WHERE s.round_id=p.round_id AND s.slot=p.slot AND s.participant_id=p.id)
 ));
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_round_participant_is_current(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_round_participant_is_current(text) TO daisy_web,daisy_audience_publisher,daisy_realtime;
--> statement-breakpoint
CREATE FUNCTION public.daisy_round_judge_slot_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE parent public.rounds%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN
  IF NOT EXISTS(SELECT 1 FROM public.rounds WHERE id=OLD.round_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Frozen judge slots cannot be removed' USING ERRCODE='23514',CONSTRAINT='round_judge_slots_frozen_count';
 END IF;
 SELECT * INTO parent FROM public.rounds WHERE id=NEW.round_id FOR NO KEY UPDATE;
 IF TG_OP='INSERT' THEN
  IF NOT public.daisy_round_is_being_constructed(NEW.round_id) OR NEW.slot<0 OR NEW.slot>=public.daisy_round_judge_slot_count(parent.rules_snapshot)
    OR NEW.current_version IS NOT NULL OR NEW.participant_id IS NOT NULL OR NEW.actor_id IS NOT NULL THEN
   RAISE EXCEPTION 'Judge slots belong to original construction' USING ERRCODE='23514',CONSTRAINT='round_judge_slots_frozen_count';
  END IF;
 ELSIF NEW.round_id<>OLD.round_id OR NEW.slot<>OLD.slot OR NEW.current_version IS NULL
   OR NEW.current_version<>coalesce(OLD.current_version,0)+1 OR NOT EXISTS(
    SELECT 1 FROM public.round_judge_assignments a WHERE a.round_id=NEW.round_id AND a.slot=NEW.slot
      AND a.version=NEW.current_version AND a.participant_id IS NOT DISTINCT FROM NEW.participant_id AND a.actor_id IS NOT DISTINCT FROM NEW.actor_id
   ) THEN
  RAISE EXCEPTION 'The pointer must advance to its appended assignment' USING ERRCODE='23514',CONSTRAINT='round_judge_slots_current_assignment';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER round_judge_slot_guard BEFORE INSERT OR UPDATE OR DELETE ON public.round_judge_slots
 FOR EACH ROW EXECUTE FUNCTION public.daisy_round_judge_slot_guard();
--> statement-breakpoint
CREATE FUNCTION public.daisy_append_round_judge_assignment(
 target_round_id text,target_slot integer,expected_round_version integer,expected_assignment_version integer,
 next_participant_id text,target_command_id text
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE parent public.rounds%ROWTYPE; current_slot public.round_judge_slots%ROWTYPE;
 identity public.round_participants%ROWTYPE; receipt public.round_commands%ROWTYPE;
 existing public.round_judge_assignments%ROWTYPE; next_version integer;
BEGIN
 SELECT * INTO parent FROM public.rounds WHERE id=target_round_id FOR NO KEY UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Missing assignment Round' USING ERRCODE='23514',CONSTRAINT='round_judge_assignment_round'; END IF;
 SELECT * INTO receipt FROM public.round_commands WHERE command_id=target_command_id AND round_id=target_round_id;
 IF NOT FOUND OR receipt.type<>'change_judge' THEN
  RAISE EXCEPTION 'Assignment needs its ordinary command' USING ERRCODE='23514',CONSTRAINT='round_judge_assignment_command';
 END IF;
 SELECT * INTO existing FROM public.round_judge_assignments WHERE round_id=target_round_id AND command_id=target_command_id;
 IF FOUND THEN
  IF existing.slot<>target_slot OR existing.participant_id IS DISTINCT FROM next_participant_id THEN
   RAISE EXCEPTION 'Assignment replay changed source' USING ERRCODE='23514',CONSTRAINT='round_judge_assignment_replay';
  END IF;
  RETURN existing.version;
 END IF;
 IF parent.version<>expected_round_version THEN
  RAISE EXCEPTION 'Assignment Round changed' USING ERRCODE='23514',CONSTRAINT='round_judge_assignment_version';
 END IF;
 SELECT * INTO current_slot FROM public.round_judge_slots WHERE round_id=target_round_id AND slot=target_slot FOR UPDATE;
 IF NOT FOUND OR current_slot.current_version IS DISTINCT FROM expected_assignment_version THEN
  RAISE EXCEPTION 'Assignment slot changed' USING ERRCODE='23514',CONSTRAINT='round_judge_assignment_version';
 END IF;
 IF next_participant_id IS NOT NULL THEN
  SELECT * INTO identity FROM public.round_participants WHERE id=next_participant_id AND round_id=target_round_id AND slot=target_slot AND seat_kind='judge';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing replacement identity' USING ERRCODE='23514',CONSTRAINT='round_judge_assignment_identity'; END IF;
 END IF;
 next_version:=coalesce(current_slot.current_version,0)+1;
 INSERT INTO public.round_judge_assignments(round_id,slot,version,participant_id,actor_id,source,command_id,recorded_at)
 VALUES(target_round_id,target_slot,next_version,next_participant_id,identity.actor_id,'command',target_command_id,receipt.applied_at);
 UPDATE public.rounds SET version=version+1,updated_at=receipt.applied_at WHERE id=target_round_id;
 RETURN next_version;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_append_round_judge_assignment(text,integer,integer,integer,text,text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_append_round_judge_assignment(text,integer,integer,integer,text,text) TO daisy_web;
--> statement-breakpoint
CREATE FUNCTION public.daisy_freeze_round_judge_assignments() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM id FROM public.rounds WHERE id=NEW.round_id FOR NO KEY UPDATE;
 INSERT INTO public.round_finalization_judge_assignments(round_id,slot,assignment_version,participant_id)
 SELECT round_id,slot,current_version,participant_id FROM public.round_judge_slots WHERE round_id=NEW.round_id ORDER BY slot;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_freeze_round_judge_assignments() FROM PUBLIC,daisy_web;
--> statement-breakpoint
CREATE TRIGGER round_finalizations_freeze_judge_assignments AFTER INSERT ON public.round_finalizations
 FOR EACH ROW EXECUTE FUNCTION public.daisy_freeze_round_judge_assignments();
--> statement-breakpoint
CREATE FUNCTION public.daisy_round_finalization_assignment_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.round_judge_slots s WHERE s.round_id=NEW.round_id AND s.slot=NEW.slot
   AND s.current_version IS NOT DISTINCT FROM NEW.assignment_version AND s.participant_id IS NOT DISTINCT FROM NEW.participant_id) THEN
  RAISE EXCEPTION 'Finalization must freeze the actual current assignment' USING ERRCODE='23514',CONSTRAINT='round_finalization_assignment_current';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER round_finalization_assignment_guard BEFORE INSERT ON public.round_finalization_judge_assignments
 FOR EACH ROW EXECUTE FUNCTION public.daisy_round_finalization_assignment_guard();
--> statement-breakpoint
CREATE FUNCTION public.daisy_round_complete_judge_slots() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE target text;
BEGIN
 IF TG_TABLE_NAME='rounds' THEN target:=NEW.id; ELSE target:=NEW.round_id; END IF;
 PERFORM id FROM public.rounds WHERE id=target FOR NO KEY UPDATE;
 IF EXISTS(SELECT 1 FROM public.rounds WHERE id=target AND status='completed') AND EXISTS(
  SELECT 1 FROM public.round_judge_slots WHERE round_id=target AND participant_id IS NULL
 ) THEN
  RAISE EXCEPTION 'An empty frozen judge slot cannot complete' USING ERRCODE='23514',CONSTRAINT='rounds_judge_slots_complete';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER rounds_judge_slots_complete AFTER INSERT OR UPDATE ON public.rounds
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.status='completed') EXECUTE FUNCTION public.daisy_round_complete_judge_slots();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER round_judge_slots_complete AFTER INSERT OR UPDATE ON public.round_judge_slots
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.daisy_round_complete_judge_slots();
--> statement-breakpoint
-- Submit and replacement serialize on the same canonical Round, even for a direct runtime insert.
CREATE FUNCTION public.daisy_ballot_current_assignment() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM id FROM public.rounds WHERE id=NEW.round_id FOR NO KEY UPDATE;
 IF NOT EXISTS(SELECT 1 FROM public.round_judge_slots s WHERE s.round_id=NEW.round_id AND s.participant_id=NEW.judge_participant_id)
  OR EXISTS(SELECT 1 FROM public.round_source_voids WHERE round_id=NEW.round_id) THEN
  RAISE EXCEPTION 'Only the current judge assignment may submit' USING ERRCODE='23514',CONSTRAINT='ballots_current_judge_assignment';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ballots_current_judge_assignment BEFORE INSERT ON public.ballots
 FOR EACH ROW EXECUTE FUNCTION public.daisy_ballot_current_assignment();
--> statement-breakpoint
CREATE FUNCTION public.daisy_finalization_ballot_assignment() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ballots b JOIN public.round_finalization_judge_assignments a
  ON a.round_id=b.round_id AND a.participant_id=b.judge_participant_id
  WHERE b.id=NEW.ballot_id AND a.round_id=NEW.round_id) THEN
  RAISE EXCEPTION 'Consumed ballot must belong to the frozen assignment' USING ERRCODE='23514',CONSTRAINT='round_finalization_ballots_assignment';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER round_finalization_ballots_assignment BEFORE INSERT ON public.round_finalization_ballots
 FOR EACH ROW EXECUTE FUNCTION public.daisy_finalization_ballot_assignment();
--> statement-breakpoint
CREATE FUNCTION public.daisy_round_source_void_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE parent public.rounds%ROWTYPE; receipt public.round_commands%ROWTYPE;
BEGIN
 SELECT * INTO parent FROM public.rounds WHERE id=NEW.round_id FOR NO KEY UPDATE;
 SELECT * INTO receipt FROM public.round_commands WHERE command_id=NEW.command_id AND round_id=NEW.round_id;
 IF parent.status NOT IN ('completed','abandoned') OR NOT coalesce(
  receipt.applied_at=NEW.recorded_at AND receipt.resulting_version=parent.version AND (
   receipt.type='void_source' AND receipt.result->>'kind'='round_source_void' AND receipt.result->>'roundId'=NEW.round_id OR
   receipt.type='stop' AND parent.status='abandoned' AND EXISTS(SELECT 1 FROM public.round_finalizations f
    WHERE f.round_id=NEW.round_id AND f.command_id=NEW.command_id AND f.resulting_version=parent.version)
  ),false) THEN
  RAISE EXCEPTION 'Source void requires its actual terminal ordinary command' USING ERRCODE='23514',CONSTRAINT='round_source_void_command';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER round_source_void_command BEFORE INSERT ON public.round_source_voids
 FOR EACH ROW EXECUTE FUNCTION public.daisy_round_source_void_guard();
--> statement-breakpoint
CREATE FUNCTION public.daisy_mark_round_source_void(target_round_id text,target_command_id text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE existing public.round_source_voids%ROWTYPE; receipt public.round_commands%ROWTYPE;
BEGIN
 PERFORM id FROM public.rounds WHERE id=target_round_id FOR NO KEY UPDATE;
 SELECT * INTO existing FROM public.round_source_voids WHERE round_id=target_round_id;
 IF FOUND THEN
  IF existing.command_id<>target_command_id THEN
   RAISE EXCEPTION 'Source was voided by another command' USING ERRCODE='23514',CONSTRAINT='round_source_void_replay';
  END IF;
  RETURN false;
 END IF;
 SELECT * INTO receipt FROM public.round_commands WHERE command_id=target_command_id AND round_id=target_round_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Missing ordinary source command' USING ERRCODE='23514',CONSTRAINT='round_source_void_command'; END IF;
 INSERT INTO public.round_source_voids(round_id,command_id,recorded_at) VALUES(target_round_id,target_command_id,receipt.applied_at);
 RETURN true;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_mark_round_source_void(text,text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_mark_round_source_void(text,text) TO daisy_web;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_winnerless_round_completion() RETURNS trigger LANGUAGE plpgsql AS $guard$
DECLARE target_round text;
BEGIN
  IF TG_TABLE_NAME = 'rounds' THEN
    target_round := NEW.id;
  ELSE
    target_round := NEW.round_id;
  END IF;
  PERFORM id FROM rounds WHERE id = target_round FOR NO KEY UPDATE;
  IF EXISTS (
    SELECT 1 FROM rounds r
    WHERE r.id = target_round AND r.status = 'completed' AND r.winning_side IS NULL AND r.ranking IS NULL
      AND EXISTS (
        SELECT 1 FROM round_participants p JOIN actors a ON a.id = p.actor_id
        WHERE p.round_id = r.id AND p.seat_kind = 'judge' AND public.daisy_round_participant_is_current(p.id) AND a.kind = 'human'
          AND NOT EXISTS (SELECT 1 FROM ballots b WHERE b.judge_participant_id = p.id)
      )
      AND (r.ballot_deadline_at IS NULL OR clock_timestamp() < r.ballot_deadline_at)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'rounds_winnerless_completion_check', MESSAGE = 'A Round with a human judge completes without a result only once every human judge has ruled or their deadline has passed';
  END IF;
  RETURN NEW;
END;
$guard$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.daisy_round_floor_fact(requested_round_id text, requested_actor_id text)
RETURNS TABLE(version bigint, status text, completed_at timestamp with time zone, audience text, channel_id text, authority_revision bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $round_floor_fact$
 SELECT r.version::bigint,r.status,r.completed_at,
 CASE WHEN p.seat_kind IN ('side','speaker') THEN 'debater' WHEN p.seat_kind IS NOT NULL THEN NULL
 WHEN r.created_by_actor_id=requested_actor_id THEN 'host' ELSE NULL END,
 c.id,c.authority_revision
 FROM public.rounds r LEFT JOIN public.round_participants p ON p.round_id=r.id AND p.actor_id=requested_actor_id AND public.daisy_round_participant_is_current(p.id)
 LEFT JOIN public.messaging_channels c ON c.round_id=r.id AND c.kind='round_floor'
 WHERE r.id=requested_round_id AND (c.id IS NULL OR (c.policy_revision=1 AND c.lifecycle='active'));
$round_floor_fact$;
