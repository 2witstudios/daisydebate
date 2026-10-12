-- Observation headers follow their resource: a deleted room, round, channel or actor (whose existing trigger dirties its inbox) removes its header at commit.
CREATE FUNCTION public.daisy_observation_resource_exists(requested_kind text, requested_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $observation_resource_exists$
  SELECT CASE requested_kind
    WHEN 'room' THEN EXISTS(SELECT FROM public.rooms WHERE id=requested_id)
    WHEN 'round' THEN EXISTS(SELECT FROM public.rounds WHERE id=requested_id)
    WHEN 'channel' THEN EXISTS(SELECT FROM public.messaging_channels WHERE id=requested_id)
    WHEN 'inbox' THEN EXISTS(SELECT FROM public.actors WHERE id=requested_id)
    ELSE false END;
$observation_resource_exists$;
REVOKE ALL ON FUNCTION public.daisy_observation_resource_exists(text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.daisy_flush_observation_headers() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $flush_observation_headers$
DECLARE dirty record;
BEGIN
  -- One deferred event fires per pending row; only the first flushes. Later events would rescan the
  -- pending index over the rows just deleted, making a large transaction quadratic.
  IF pg_catalog.current_setting('daisy.observation_flushed', true) = 'yes' THEN RETURN NULL; END IF;
  -- The complete key union exists now. Only leaf metadata locks remain; acquire them once globally.
  FOR dirty IN SELECT kind,resource_id,disclose,purge FROM public.resource_observation_pending
    WHERE transaction_id=pg_catalog.pg_current_xact_id() ORDER BY kind,resource_id
  LOOP
    -- A header never outlives its resource: absence is the purge observers already fail closed on.
    IF NOT public.daisy_observation_resource_exists(dirty.kind,dirty.resource_id) THEN
      DELETE FROM public.resource_observation_headers WHERE kind=dirty.kind AND resource_id=dirty.resource_id;
      CONTINUE;
    END IF;
    INSERT INTO public.resource_observation_headers(kind,resource_id,content_revision,disclosure_revision,purge_generation)
      VALUES(dirty.kind,dirty.resource_id,1,1,CASE WHEN dirty.purge THEN 1 ELSE 0 END)
    ON CONFLICT(kind,resource_id) DO UPDATE SET
      content_revision=resource_observation_headers.content_revision+1,
      disclosure_revision=resource_observation_headers.disclosure_revision+CASE WHEN dirty.disclose THEN 1 ELSE 0 END,
      purge_generation=resource_observation_headers.purge_generation+CASE WHEN dirty.purge THEN 1 ELSE 0 END;
  END LOOP;
  DELETE FROM public.resource_observation_pending WHERE transaction_id=pg_catalog.pg_current_xact_id();
  PERFORM pg_catalog.set_config('daisy.observation_flushed', 'yes', true);
  RETURN NULL;
END;
$flush_observation_headers$;
REVOKE ALL ON FUNCTION public.daisy_flush_observation_headers() FROM PUBLIC;
