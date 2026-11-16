-- Unsubmitted retirement remains possible before the fixture result; terminal witnesses never reselect current occupants.
CREATE OR REPLACE FUNCTION public.daisy_round_judge_assignment_guard() RETURNS trigger
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
  IF parent.status NOT IN ('opening','active','completed','abandoned') OR
   (parent.status IN ('completed','abandoned') AND NOT EXISTS(SELECT 1 FROM public.round_finalizations WHERE round_id=NEW.round_id)) OR
   EXISTS(SELECT 1 FROM public.round_source_voids WHERE round_id=NEW.round_id)
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
CREATE OR REPLACE FUNCTION public.daisy_round_complete_judge_slots() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE target text; empty_slot boolean;
BEGIN
 IF TG_TABLE_NAME='rounds' THEN target:=NEW.id; ELSE target:=NEW.round_id; END IF;
 PERFORM id FROM public.rounds WHERE id=target FOR NO KEY UPDATE;
 IF EXISTS(SELECT 1 FROM public.rounds WHERE id=target AND status='completed') THEN
  IF EXISTS(SELECT 1 FROM public.round_finalizations WHERE round_id=target) THEN
   -- Finality selected this immutable full panel. Later retirement revokes current
   -- authority, without changing that ending or giving another judge a vote in it.
   SELECT EXISTS(SELECT 1 FROM public.round_finalization_judge_assignments WHERE round_id=target AND participant_id IS NULL)
    OR (SELECT count(*) FROM public.round_finalization_judge_assignments WHERE round_id=target)
       <>(SELECT count(*) FROM public.round_judge_slots WHERE round_id=target) INTO empty_slot;
  ELSE
   SELECT EXISTS(SELECT 1 FROM public.round_judge_slots WHERE round_id=target AND participant_id IS NULL) INTO empty_slot;
  END IF;
  IF empty_slot THEN
   RAISE EXCEPTION 'An empty frozen judge slot cannot complete' USING ERRCODE='23514',CONSTRAINT='rounds_judge_slots_complete';
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
