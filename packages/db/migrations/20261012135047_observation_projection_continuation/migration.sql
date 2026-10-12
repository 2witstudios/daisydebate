-- Channel projection pages return the complete descending prefix that fits the caller's byte budget.
-- Size is measured on jsonb text, which is never shorter than compact JSON, so the cut is conservative.
DROP FUNCTION public.daisy_observation_channel_body(text,bigint,integer);
--> statement-breakpoint
CREATE FUNCTION public.daisy_observation_channel_body(requested_id text,before_sequence bigint,page_limit integer,page_bytes integer) RETURNS jsonb
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
            ||pg_catalog.jsonb_build_object('text',s.text,'editedAt',public.daisy_observation_iso(s.edited_at),'removedAt',public.daisy_observation_iso(s.removed_at)) AS item
          FROM (SELECT id,channel_id,author_actor_id,sequence,change_version,text,created_at,edited_at,removed_at,reply_to_message_id
            FROM public.messaging_messages WHERE channel_id=requested_id AND (before_sequence IS NULL OR sequence<before_sequence)
            ORDER BY sequence DESC LIMIT page_limit+1) s) m) ranked) measured);
END;
$channel_body$;
REVOKE ALL ON FUNCTION public.daisy_observation_channel_body(text,bigint,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.daisy_observation_channel_body(text,bigint,integer,integer) TO daisy_projection;
