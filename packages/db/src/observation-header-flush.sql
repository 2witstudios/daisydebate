-- Dirt is transaction-scoped, never an outbox horizon or cross-node authorization cache.
CREATE OR REPLACE FUNCTION public.daisy_advance_observation_header(requested_kind text, requested_id text, disclose boolean, purge boolean)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $advance_observation_header$
BEGIN
  IF requested_kind IS NULL OR requested_kind NOT IN ('room','round','channel','inbox')
    OR requested_id IS NULL OR requested_id !~ '^[a-z0-9]{24}$' OR disclose IS NULL OR purge IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid observation resource';
  END IF;
  INSERT INTO public.resource_observation_pending(transaction_id,kind,resource_id,disclose,purge)
    VALUES(pg_catalog.pg_current_xact_id(),requested_kind,requested_id,disclose,purge)
  ON CONFLICT(transaction_id,kind,resource_id) DO UPDATE SET
    disclose=resource_observation_pending.disclose OR EXCLUDED.disclose,
    purge=resource_observation_pending.purge OR EXCLUDED.purge;
END;
$advance_observation_header$;
REVOKE ALL ON FUNCTION public.daisy_advance_observation_header(text,text,boolean,boolean) FROM PUBLIC;

CREATE FUNCTION public.daisy_flush_observation_headers() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $flush_observation_headers$
DECLARE dirty record;
BEGIN
  -- The complete key union exists now. Only leaf metadata locks remain; acquire them once globally.
  FOR dirty IN SELECT kind,resource_id,disclose,purge FROM public.resource_observation_pending
    WHERE transaction_id=pg_catalog.pg_current_xact_id() ORDER BY kind,resource_id
  LOOP
    INSERT INTO public.resource_observation_headers(kind,resource_id,content_revision,disclosure_revision,purge_generation)
      VALUES(dirty.kind,dirty.resource_id,1,1,CASE WHEN dirty.purge THEN 1 ELSE 0 END)
    ON CONFLICT(kind,resource_id) DO UPDATE SET
      content_revision=resource_observation_headers.content_revision+1,
      disclosure_revision=resource_observation_headers.disclosure_revision+CASE WHEN dirty.disclose THEN 1 ELSE 0 END,
      purge_generation=resource_observation_headers.purge_generation+CASE WHEN dirty.purge THEN 1 ELSE 0 END;
  END LOOP;
  DELETE FROM public.resource_observation_pending WHERE transaction_id=pg_catalog.pg_current_xact_id();
  RETURN NULL;
END;
$flush_observation_headers$;
REVOKE ALL ON FUNCTION public.daisy_flush_observation_headers() FROM PUBLIC;
REVOKE ALL ON public.resource_observation_pending FROM PUBLIC,daisy_web,daisy_realtime,daisy_projection;
CREATE CONSTRAINT TRIGGER daisy_observation_commit_flush AFTER INSERT ON public.resource_observation_pending
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.daisy_flush_observation_headers();
