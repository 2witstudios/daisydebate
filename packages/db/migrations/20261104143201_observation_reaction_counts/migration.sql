-- Reaction counts join the observed channel window (ADR 0115). Counts only: the
-- function selects no reactor, so a shared body cannot carry one. A removed
-- message's counts stay empty here as they do in the projector. The return
-- columns change, so the function is replaced and re-granted.
DROP FUNCTION public.daisy_observation_channel_messages(text, integer);
--> statement-breakpoint
CREATE FUNCTION public.daisy_observation_channel_messages(requested_channel_id text, item_limit integer)
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
  SELECT s.change_version, c.authority_revision, m.id, m.author_actor_id, m.sequence,
    m.change_version, m.text, m.reply_to_message_id, m.created_at, m.edited_at, m.removed_at,
    m.reactions
  FROM public.messaging_channel_streams AS s
  JOIN public.messaging_channels AS c ON c.id = s.channel_id
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
  WHERE s.channel_id = requested_channel_id
  ORDER BY m.sequence DESC NULLS LAST;
$observation_channel_messages$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_observation_channel_messages(text, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_observation_channel_messages(text, integer) TO daisy_realtime;
