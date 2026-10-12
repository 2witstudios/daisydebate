CREATE TABLE "resource_observation_pending" (
	"transaction_id" xid8,
	"kind" text,
	"resource_id" text,
	"disclose" boolean NOT NULL,
	"purge" boolean NOT NULL,
	CONSTRAINT "resource_observation_pending_pkey" PRIMARY KEY("transaction_id","kind","resource_id"),
	CONSTRAINT "observation_pending_kind" CHECK ("kind" in ('room', 'round', 'channel', 'inbox')),
	CONSTRAINT "observation_pending_id" CHECK ("resource_id" ~ '^[a-z0-9]{24}$')
);

--> statement-breakpoint
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

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.daisy_observation_inbox_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $observation_inbox_changed$
DECLARE
  previous jsonb := CASE WHEN TG_OP='INSERT' THEN NULL ELSE pg_catalog.to_jsonb(OLD) END;
  current_row jsonb := CASE WHEN TG_OP='DELETE' THEN NULL ELSE pg_catalog.to_jsonb(NEW) END;
  value jsonb := COALESCE(current_row,previous);
  subject text;
BEGIN
  IF TG_OP='UPDATE' AND current_row IS NOT DISTINCT FROM previous THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME IN ('messaging_actor_states','messaging_group_grants') THEN
    PERFORM public.daisy_advance_observation_header('inbox',value->>'actor_id',TG_TABLE_NAME='messaging_group_grants',TG_TABLE_NAME='messaging_group_grants' AND TG_OP='DELETE');
  ELSIF TG_TABLE_NAME='messaging_group_invitations' THEN
    FOR subject IN SELECT DISTINCT id FROM pg_catalog.unnest(ARRAY[value->>'invitee_actor_id',value->>'invited_by_actor_id']) AS ids(id) ORDER BY id LOOP
      PERFORM public.daisy_advance_observation_header('inbox',subject,true,TG_OP='DELETE');
    END LOOP;
  ELSE
    FOR subject IN
      SELECT low_actor_id AS id FROM public.messaging_dm_pairs WHERE channel_id=value->>'channel_id'
      UNION SELECT high_actor_id FROM public.messaging_dm_pairs WHERE channel_id=value->>'channel_id'
      UNION SELECT actor_id FROM public.messaging_group_grants WHERE channel_id=value->>'channel_id' AND revoked_at IS NULL
      ORDER BY id
    LOOP
      PERFORM public.daisy_advance_observation_header('inbox',subject,false,TG_OP='DELETE');
    END LOOP;
    IF TG_TABLE_NAME='messaging_messages' AND (TG_OP='DELETE' OR (current_row->>'removed_at' IS NOT NULL AND previous->>'removed_at' IS NULL)) THEN
      PERFORM public.daisy_advance_observation_header('channel',value->>'channel_id',false,true);
    END IF;
  END IF;
  RETURN NULL;
END;
$observation_inbox_changed$;
REVOKE ALL ON FUNCTION public.daisy_observation_inbox_changed() FROM PUBLIC;
