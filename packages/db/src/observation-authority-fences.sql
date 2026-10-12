CREATE FUNCTION public.daisy_observation_authority_fences(resources jsonb, pairs jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $observation_authority_fences$
BEGIN
  IF resources IS NULL OR pg_catalog.jsonb_typeof(resources)<>'array' OR pg_catalog.jsonb_array_length(resources) NOT BETWEEN 1 AND 256
    OR pairs IS NULL OR pg_catalog.jsonb_typeof(pairs)<>'array' OR pg_catalog.jsonb_array_length(pairs)>4096
    OR EXISTS(SELECT FROM pg_catalog.jsonb_to_recordset(resources) r(kind text,id text) WHERE kind IS NULL OR kind NOT IN ('room','round','channel','inbox') OR id IS NULL OR id !~ '^[a-z0-9]{24}$')
    OR EXISTS(SELECT FROM pg_catalog.jsonb_to_recordset(pairs) p(low text,high text) WHERE low IS NULL OR high IS NULL OR low !~ '^[a-z0-9]{24}$' OR high !~ '^[a-z0-9]{24}$' OR low>=high)
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid observation fence selector'; END IF;
  -- The complete account set is already SHARE-fenced by the owning operation.
  PERFORM p.low_actor_id FROM public.messaging_contact_pairs p JOIN pg_catalog.jsonb_to_recordset(pairs) wanted(low text,high text)
    ON p.low_actor_id=wanted.low AND p.high_actor_id=wanted.high ORDER BY p.low_actor_id,p.high_actor_id FOR SHARE OF p;
  PERFORM r.id FROM public.rooms r JOIN pg_catalog.jsonb_to_recordset(resources) wanted(kind text,id text)
    ON wanted.kind='room' AND r.id=wanted.id ORDER BY r.id FOR SHARE OF r;
  PERFORM r.id FROM public.rounds r JOIN pg_catalog.jsonb_to_recordset(resources) wanted(kind text,id text)
    ON wanted.kind='round' AND r.id=wanted.id ORDER BY r.id FOR SHARE OF r;
  PERFORM c.id FROM public.messaging_channels c JOIN pg_catalog.jsonb_to_recordset(resources) wanted(kind text,id text)
    ON wanted.kind='channel' AND c.id=wanted.id ORDER BY c.id FOR SHARE OF c;
END;
$observation_authority_fences$;
REVOKE ALL ON FUNCTION public.daisy_observation_authority_fences(jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.daisy_observation_authority_fences(jsonb,jsonb) TO daisy_web,daisy_realtime;

CREATE FUNCTION public.daisy_observation_projection_fence(requested_kind text,requested_id text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $observation_projection_fence$
BEGIN
  IF requested_kind IS NULL OR requested_kind NOT IN ('room','round','channel','inbox') OR requested_id IS NULL OR requested_id !~ '^[a-z0-9]{24}$' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid projection fence selector';
  END IF;
  IF requested_kind='room' THEN PERFORM id FROM public.rooms WHERE id=requested_id FOR SHARE;
  ELSIF requested_kind='round' THEN PERFORM id FROM public.rounds WHERE id=requested_id FOR SHARE;
  ELSIF requested_kind='channel' THEN PERFORM id FROM public.messaging_channels WHERE id=requested_id FOR SHARE;
  ELSE RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Inbox requires its owning batched authority operation'; END IF;
END;
$observation_projection_fence$;
REVOKE ALL ON FUNCTION public.daisy_observation_projection_fence(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.daisy_observation_projection_fence(text,text) TO daisy_projection;

-- Authority renewal reads only indexed dependency metadata; projection body columns stay unavailable.
GRANT SELECT (id,room_id,actor_id,role,slot) ON public.room_participants TO daisy_realtime;
GRANT SELECT ON public.resource_observation_headers TO daisy_realtime;
