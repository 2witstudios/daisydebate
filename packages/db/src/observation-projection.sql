CREATE FUNCTION public.daisy_observation_iso(value timestamptz) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog,pg_temp
AS $observation_iso$ SELECT pg_catalog.to_char(value AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $observation_iso$;
REVOKE ALL ON FUNCTION public.daisy_observation_iso(timestamptz) FROM PUBLIC;

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

CREATE OR REPLACE FUNCTION public.daisy_observation_channel_body(requested_id text,before_sequence bigint,page_limit integer,page_bytes integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp
AS $channel_body$
BEGIN
  IF page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 50 OR (before_sequence IS NOT NULL AND before_sequence NOT BETWEEN 1 AND 9007199254740991)
    OR page_bytes IS NULL OR page_bytes NOT BETWEEN 2 AND 1048576 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid history window'; END IF;
  RETURN (SELECT pg_catalog.jsonb_build_object(
      'rows',COALESCE(pg_catalog.jsonb_agg(measured.item ORDER BY measured.sequence DESC) FILTER (WHERE measured.included),'[]'::jsonb),
      'scanned',pg_catalog.count(*),
      'included',pg_catalog.count(*) FILTER (WHERE measured.included))
    FROM (SELECT ranked.sequence,ranked.item,ranked.position<=page_limit AND ranked.cumulative<=page_bytes AS included
      FROM (SELECT m.sequence,m.item,
          pg_catalog.row_number() OVER (ORDER BY m.sequence DESC) AS position,
          -- '[' + items joined by ',' + ']' = 1 + sum(item bytes + 1).
          1+pg_catalog.sum(pg_catalog.octet_length(m.item::text)+1) OVER (ORDER BY m.sequence DESC) AS cumulative
        FROM (SELECT s.sequence,pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object('id',s.id,'channelId',s.channel_id,'authorActorId',s.author_actor_id,
            'sequence',s.sequence,'changeVersion',s.change_version,'text',s.text,'createdAt',public.daisy_observation_iso(s.created_at),
            'editedAt',public.daisy_observation_iso(s.edited_at),'removedAt',public.daisy_observation_iso(s.removed_at),'replyToMessageId',s.reply_to_message_id))
            ||pg_catalog.jsonb_build_object('text',s.text,'editedAt',public.daisy_observation_iso(s.edited_at),'removedAt',public.daisy_observation_iso(s.removed_at),
              -- Shared counts only; whose reactions they are is each viewer's own overlay.
              'reactions',CASE WHEN s.removed_at IS NULL THEN COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('reaction',x.reaction,'count',x.n) ORDER BY x.reaction)
                FROM (SELECT reaction,pg_catalog.count(*)::integer n FROM public.messaging_reactions WHERE message_id=s.id GROUP BY reaction) x),'[]'::jsonb) ELSE '[]'::jsonb END) AS item
          FROM (SELECT id,channel_id,author_actor_id,sequence,change_version,text,created_at,edited_at,removed_at,reply_to_message_id
            FROM public.messaging_messages WHERE channel_id=requested_id AND (before_sequence IS NULL OR sequence<before_sequence)
            ORDER BY sequence DESC LIMIT page_limit+1) s) m) ranked) measured);
END;
$channel_body$;
REVOKE ALL ON FUNCTION public.daisy_observation_channel_body(text,bigint,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.daisy_observation_channel_body(text,bigint,integer,integer) TO daisy_projection;
