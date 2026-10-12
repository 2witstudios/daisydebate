-- Body bounds are the accepted-format limits (MAX_FORMAT_SEATS, MAX_FORMAT_SEGMENTS), passed by the owning reader.
DROP FUNCTION public.daisy_observation_room_body(text);
DROP FUNCTION public.daisy_observation_round_body(text);
--> statement-breakpoint
CREATE FUNCTION public.daisy_observation_room_body(requested_id text,seat_limit integer) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp
AS $room_body$
  SELECT pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'room',pg_catalog.jsonb_build_object('id',r.id,'hostActorId',r.host_actor_id,'title',r.title,'topic',r.topic,'visibility',r.visibility,'status',r.status,
      'version',r.version,'changeVersion',r.change_version,'formatId',r.format_id,'formatVersion',r.format_version,'presetVersion',r.preset_version,
      'competitionType',r.competition_type,'length',r.length,'config',r.config,'executionPlan',r.execution_plan,
      'prepStartedAt',public.daisy_observation_iso(r.prep_started_at),'prepRemainingMs',r.prep_remaining_ms),
    'rules',r.rules_snapshot,'definition',f.definition,
    'participants',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',p.id,'actorId',p.actor_id,'role',p.role,'slot',p.slot,'readinessVersion',p.readiness_version) ORDER BY p.id)
      FROM (SELECT id,actor_id,role,slot,readiness_version FROM public.room_participants WHERE room_id=r.id ORDER BY id LIMIT seat_limit+1) p),'[]'::jsonb),
    'roundRef',(SELECT pg_catalog.jsonb_build_object('id',id,'status',status) FROM public.rounds WHERE room_id=r.id)
  )) FROM public.rooms r JOIN public.format_revisions f ON f.format_id=r.format_id AND f.version=r.format_version
  WHERE r.id=requested_id AND seat_limit BETWEEN 1 AND 256 AND (SELECT count(*) FROM (SELECT 1 FROM public.room_participants WHERE room_id=r.id LIMIT seat_limit+1) bounded)<=seat_limit;
$room_body$;
REVOKE ALL ON FUNCTION public.daisy_observation_room_body(text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.daisy_observation_room_body(text,integer) TO daisy_projection;

CREATE FUNCTION public.daisy_observation_round_body(requested_id text,seat_limit integer,segment_limit integer) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp
AS $round_body$
  SELECT pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'round',pg_catalog.jsonb_build_object('id',r.id,'competitionType',r.competition_type,'formatId',r.format_id,'formatVersion',r.format_version,
      'resolution',r.resolution,'status',r.status,'currentStage',r.current_stage,'startedAt',public.daisy_observation_iso(r.started_at),
      'completedAt',public.daisy_observation_iso(r.completed_at),'outcome',r.outcome,'version',r.version),
    'rules',r.rules_snapshot,'checkpoint',r.runtime_state,
    'participants',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',p.id,'actorId',p.actor_id,'role',p.role,'slot',p.slot) ORDER BY p.id)
      FROM (SELECT id,actor_id,role,slot FROM public.round_participants WHERE round_id=r.id ORDER BY id LIMIT seat_limit+1) p),'[]'::jsonb),
    'segments',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',s.id,'sequence',s.sequence,'type',s.type,'rulesSegmentKey',s.rules_segment_key,
      'startedAt',public.daisy_observation_iso(s.started_at),'endedAt',public.daisy_observation_iso(s.ended_at),'durationMs',s.duration_ms) ORDER BY s.sequence)
      FROM (SELECT id,sequence,type,rules_segment_key,started_at,ended_at,duration_ms FROM public.round_segments WHERE round_id=r.id ORDER BY sequence LIMIT segment_limit+1) s),'[]'::jsonb)
  )) FROM public.rounds r WHERE r.id=requested_id AND seat_limit BETWEEN 1 AND 256 AND segment_limit BETWEEN 1 AND 256
    AND (SELECT count(*) FROM (SELECT 1 FROM public.round_participants WHERE round_id=r.id LIMIT seat_limit+1) bounded)<=seat_limit
    AND (SELECT count(*) FROM (SELECT 1 FROM public.round_segments WHERE round_id=r.id LIMIT segment_limit+1) bounded)<=segment_limit;
$round_body$;
REVOKE ALL ON FUNCTION public.daisy_observation_round_body(text,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.daisy_observation_round_body(text,integer,integer) TO daisy_projection;
