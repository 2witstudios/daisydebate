-- Each viewer's own reactions for the messages in their binding's window, read in the fenced authority transaction,
-- bounded to the overlay contract (at most 50 messages x 8 reactions of at most 16 UTF-16 units).
CREATE OR REPLACE FUNCTION public.daisy_observation_own_reactions(bindings jsonb)
RETURNS TABLE(binding integer, message_id text, reaction text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $own_reactions$
BEGIN
  IF bindings IS NULL OR pg_catalog.jsonb_typeof(bindings)<>'array' OR pg_catalog.jsonb_array_length(bindings) NOT BETWEEN 1 AND 256
    OR EXISTS(SELECT FROM pg_catalog.jsonb_to_recordset(bindings) b(channel text,actor text,before bigint,"limit" integer)
      WHERE channel IS NULL OR channel !~ '^[a-z0-9]{24}$' OR actor IS NULL OR actor !~ '^[a-z0-9]{24}$'
        OR "limit" IS NULL OR "limit" NOT BETWEEN 1 AND 50 OR (before IS NOT NULL AND before NOT BETWEEN 1 AND 9007199254740991))
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid own reaction windows'; END IF;
  RETURN QUERY SELECT (b.ordinality-1)::integer, m.id, r.reaction
    FROM pg_catalog.jsonb_array_elements(bindings) WITH ORDINALITY b(value,ordinality)
    CROSS JOIN LATERAL (SELECT id FROM public.messaging_messages
      WHERE channel_id=b.value->>'channel' AND removed_at IS NULL
        AND (b.value->>'before' IS NULL OR sequence<(b.value->>'before')::bigint)
      ORDER BY sequence DESC LIMIT (b.value->>'limit')::integer) m
    -- The overlay contract: at most 8 reactions per message, each at most 16 UTF-16 units.
    CROSS JOIN LATERAL (SELECT x.reaction FROM public.messaging_reactions x
      WHERE x.message_id=m.id AND x.actor_id=b.value->>'actor'
        AND (SELECT pg_catalog.sum(CASE WHEN pg_catalog.ascii(c)>65535 THEN 2 ELSE 1 END)
          FROM pg_catalog.regexp_split_to_table(x.reaction,'') c)<=16
      ORDER BY x.reaction LIMIT 8) r
    ORDER BY b.ordinality, m.id, r.reaction;
END;
$own_reactions$;
REVOKE ALL ON FUNCTION public.daisy_observation_own_reactions(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.daisy_observation_own_reactions(jsonb) TO daisy_realtime;
