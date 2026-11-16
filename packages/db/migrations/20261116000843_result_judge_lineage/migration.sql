-- Retained decided records gain the actual prefix selected by ordinary finality.
-- The observation source and instant remain observations, never invented old commands or assignment times.
-- The migration owner temporarily suspends only this table's append guard in this transaction;
-- runtime UPDATE/DELETE privileges and every competitive value/digest remain unchanged.
ALTER TABLE public.results DISABLE TRIGGER results_append_only;
--> statement-breakpoint
UPDATE public.results result SET competition_record=jsonb_set(result.competition_record,'{source,judgeAssignments}',(
 SELECT jsonb_agg(jsonb_build_object('slot',frozen.slot,'versions',(
  SELECT jsonb_agg(jsonb_build_object(
   'version',assignment.version,'participantId',assignment.participant_id,'actorId',assignment.actor_id,
   'source',assignment.source,'commandId',assignment.command_id,
   'recordedAt',to_char(assignment.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ) ORDER BY assignment.version)
  FROM public.round_judge_assignments assignment
  WHERE assignment.round_id=frozen.round_id AND assignment.slot=frozen.slot AND assignment.version<=frozen.assignment_version
 )) ORDER BY frozen.slot)
 FROM public.round_finalization_judge_assignments frozen WHERE frozen.round_id=result.round_id
)) WHERE result.kind='decided';
--> statement-breakpoint
ALTER TABLE public.results ENABLE TRIGGER results_append_only;
