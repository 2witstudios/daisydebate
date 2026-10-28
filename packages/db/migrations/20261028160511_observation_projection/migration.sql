-- ADR 0089: shared resource observation reads, channel messages first.
-- daisy_projection is a NOLOGIN role that owns exactly two SECURITY DEFINER
-- reads and holds only the columns they disclose. daisy_realtime gains
-- EXECUTE on them, never a table grant: the gateway's authorization role
-- still cannot read message content directly.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'daisy_projection') THEN
    CREATE ROLE daisy_projection NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO daisy_projection;
--> statement-breakpoint
GRANT SELECT (channel_id, change_version) ON public.messaging_channel_streams TO daisy_projection;
--> statement-breakpoint
GRANT SELECT (id, authority_revision) ON public.messaging_channels TO daisy_projection;
--> statement-breakpoint
GRANT SELECT (id, channel_id, author_actor_id, sequence, change_version, text, reply_to_message_id, created_at, edited_at, removed_at) ON public.messaging_messages TO daisy_projection;
--> statement-breakpoint
-- The owner's batched header read: one indexed MVCC statement for every
-- owned channel, no locks, no outbox finality predicate. A missing id is a
-- deleted channel. At most 1,024 ids per call.
CREATE FUNCTION public.daisy_observation_channel_headers(requested_channel_ids text[])
RETURNS TABLE (channel_id text, change_version bigint, authority_revision bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $observation_channel_headers$
  SELECT s.channel_id, s.change_version, c.authority_revision
  FROM public.messaging_channel_streams AS s
  JOIN public.messaging_channels AS c ON c.id = s.channel_id
  WHERE s.channel_id = ANY (requested_channel_ids[1:1024]);
$observation_channel_headers$;
--> statement-breakpoint
-- One coherent snapshot: the stream header, the disclosure revision and the
-- newest item_limit + 1 messages in a single statement (one MVCC snapshot),
-- so the body and its revisions always agree. The header row is returned
-- even for an empty channel (message columns null).
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
  removed_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $observation_channel_messages$
  SELECT s.change_version, c.authority_revision, m.id, m.author_actor_id, m.sequence,
    m.change_version, m.text, m.reply_to_message_id, m.created_at, m.edited_at, m.removed_at
  FROM public.messaging_channel_streams AS s
  JOIN public.messaging_channels AS c ON c.id = s.channel_id
  LEFT JOIN LATERAL (
    SELECT mm.id, mm.author_actor_id, mm.sequence, mm.change_version, mm.text,
      mm.reply_to_message_id, mm.created_at, mm.edited_at, mm.removed_at
    FROM public.messaging_messages AS mm
    WHERE mm.channel_id = s.channel_id
    ORDER BY mm.sequence DESC
    LIMIT least(greatest(item_limit, 1), 100) + 1
  ) AS m ON true
  WHERE s.channel_id = requested_channel_id
  ORDER BY m.sequence DESC NULLS LAST;
$observation_channel_messages$;
--> statement-breakpoint
ALTER FUNCTION public.daisy_observation_channel_headers(text[]) OWNER TO daisy_projection;
--> statement-breakpoint
ALTER FUNCTION public.daisy_observation_channel_messages(text, integer) OWNER TO daisy_projection;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_observation_channel_headers(text[]) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_observation_channel_messages(text, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_observation_channel_headers(text[]) TO daisy_realtime;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_observation_channel_messages(text, integer) TO daisy_realtime;
