-- The contextual floor shares Messaging storage, but never social pair/grant authority.
-- SECURITY DEFINER supplies the Round fence to realtime without UPDATE grants.
CREATE FUNCTION public.daisy_round_floor_read_fence(requested_round_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $floor_fence$
BEGIN
 PERFORM id FROM public.rounds WHERE id=requested_round_id FOR SHARE;
 RETURN FOUND;
END;
$floor_fence$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_round_floor_read_fence(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_round_floor_read_fence(text) TO daisy_web, daisy_realtime;
--> statement-breakpoint
-- Only Round identity, lifecycle and this viewer's audience category leave this read.
CREATE FUNCTION public.daisy_round_floor_channel(requested_channel_id text)
RETURNS TABLE(round_id text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $floor_channel$
 SELECT c.round_id FROM public.messaging_channels c WHERE c.id=requested_channel_id AND c.kind='round_floor';
$floor_channel$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_round_floor_channel(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_round_floor_channel(text) TO daisy_realtime;
--> statement-breakpoint
CREATE FUNCTION public.daisy_round_floor_fact(requested_round_id text, requested_actor_id text)
RETURNS TABLE(version bigint,status text,completed_at timestamptz,audience text,channel_id text,authority_revision bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $floor_fact$
 SELECT r.version::bigint,r.status,r.completed_at,
 CASE WHEN p.role IN ('affirmative','negative') THEN 'debater' WHEN p.role='judge' THEN NULL
 WHEN r.created_by_actor_id=requested_actor_id THEN 'host' ELSE NULL END,
 c.id,c.authority_revision
 FROM public.rounds r LEFT JOIN public.round_participants p ON p.round_id=r.id AND p.actor_id=requested_actor_id
 LEFT JOIN public.messaging_channels c ON c.round_id=r.id AND c.kind='round_floor'
 WHERE r.id=requested_round_id AND (c.id IS NULL OR (c.policy_revision=1 AND c.lifecycle='active'));
$floor_fact$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_round_floor_fact(text,text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_round_floor_fact(text,text) TO daisy_web, daisy_realtime;

--> statement-breakpoint
CREATE FUNCTION public.daisy_round_floor_channel_read_fence(requested_channel_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $floor_channel_fence$
BEGIN
 PERFORM id FROM public.messaging_channels WHERE id=requested_channel_id AND kind='round_floor' FOR SHARE;
 RETURN FOUND;
END;
$floor_channel_fence$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_round_floor_channel_read_fence(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_round_floor_channel_read_fence(text) TO daisy_realtime;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.daisy_observation_channel_headers(requested_channel_ids text[])
RETURNS TABLE (channel_id text, change_version bigint, authority_revision bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $observation_channel_headers$
  SELECT s.channel_id, s.change_version, case when c.kind='round_floor' then c.authority_revision+r.version else c.authority_revision end
  FROM public.messaging_channel_streams AS s
  JOIN public.messaging_channels AS c ON c.id = s.channel_id
  LEFT JOIN public.rounds r ON r.id=c.round_id
  WHERE (c.kind<>'round_floor' OR (r.completed_at IS NULL OR clock_timestamp()<r.completed_at+interval '180 days')) AND s.channel_id = ANY (requested_channel_ids[1:1024]);
$observation_channel_headers$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.daisy_observation_channel_messages(requested_channel_id text, item_limit integer)
RETURNS TABLE (
  change_version bigint,
  authority_revision bigint,
  id text,
  author_actor_id text,
  sequence bigint,
  message_change_version bigint,
  text text,
  reply_to_message_id text,
  created_at timestamptz,
  edited_at timestamptz,
  removed_at timestamptz,
  reactions jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $observation_channel_messages$
  SELECT s.change_version, case when c.kind='round_floor' then c.authority_revision+r.version else c.authority_revision end, m.id, m.author_actor_id, m.sequence,
    m.change_version, m.text, m.reply_to_message_id, m.created_at, m.edited_at, m.removed_at,
    m.reactions
  FROM public.messaging_channel_streams AS s
  JOIN public.messaging_channels AS c ON c.id = s.channel_id
  LEFT JOIN public.rounds r ON r.id=c.round_id
  LEFT JOIN LATERAL (
    SELECT mm.id, mm.author_actor_id, mm.sequence, mm.change_version, mm.text,
      mm.reply_to_message_id, mm.created_at, mm.edited_at, mm.removed_at,
      CASE WHEN mm.text IS NULL OR mm.removed_at IS NOT NULL THEN '[]'::jsonb ELSE (
        SELECT coalesce(jsonb_agg(jsonb_build_object('reaction', grouped.reaction, 'count', grouped.total)
          ORDER BY grouped.reaction), '[]'::jsonb)
        FROM (
          SELECT r.reaction, count(*)::integer AS total
          FROM public.messaging_reactions AS r
          WHERE r.channel_id = mm.channel_id AND r.message_id = mm.id
          GROUP BY r.reaction
        ) AS grouped
      ) END AS reactions
    FROM public.messaging_messages AS mm
    WHERE mm.channel_id = s.channel_id
    ORDER BY mm.sequence DESC
    LIMIT least(greatest(item_limit, 1), 100) + 1
  ) AS m ON true
  WHERE (c.kind<>'round_floor' OR (r.completed_at IS NULL OR clock_timestamp()<r.completed_at+interval '180 days')) AND s.channel_id = requested_channel_id
  ORDER BY m.sequence DESC NULLS LAST;
$observation_channel_messages$;
