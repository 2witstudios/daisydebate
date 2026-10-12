CREATE OR REPLACE FUNCTION public.daisy_observation_resource_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $observation_resource_changed$
DECLARE
  previous jsonb := CASE WHEN TG_OP='INSERT' THEN NULL ELSE pg_catalog.to_jsonb(OLD) END;
  current_row jsonb := CASE WHEN TG_OP='DELETE' THEN NULL ELSE pg_catalog.to_jsonb(NEW) END;
  resource_id text := COALESCE(current_row->>'id',previous->>'id');
  disclose boolean;
BEGIN
  IF TG_OP='UPDATE' AND (current_row-'updated_at') IS NOT DISTINCT FROM (previous-'updated_at') THEN RETURN NULL; END IF;
  disclose := TG_OP<>'UPDATE' OR (current_row->>'visibility',current_row->>'host_actor_id',current_row->>'created_by_actor_id',current_row->>'policy_revision',current_row->>'authority_revision',current_row->>'lifecycle')
    IS DISTINCT FROM (previous->>'visibility',previous->>'host_actor_id',previous->>'created_by_actor_id',previous->>'policy_revision',previous->>'authority_revision',previous->>'lifecycle');
  PERFORM public.daisy_advance_observation_header(TG_ARGV[0],resource_id,disclose,TG_OP='DELETE');
  RETURN NULL;
END;
$observation_resource_changed$;
REVOKE ALL ON FUNCTION public.daisy_observation_resource_changed() FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.daisy_observation_audience_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $observation_audience_changed$
DECLARE
  previous jsonb := CASE WHEN TG_OP='INSERT' THEN NULL ELSE pg_catalog.to_jsonb(OLD) END;
  current_row jsonb := CASE WHEN TG_OP='DELETE' THEN NULL ELSE pg_catalog.to_jsonb(NEW) END;
  resource_id text := COALESCE(current_row->>TG_ARGV[1],previous->>TG_ARGV[1]);
BEGIN
  IF TG_OP='UPDATE' AND current_row IS NOT DISTINCT FROM previous THEN RETURN NULL; END IF;
  PERFORM public.daisy_advance_observation_header(TG_ARGV[0],resource_id,
    TG_OP<>'UPDATE' OR TG_TABLE_NAME<>'room_participants' OR
      (current_row->>'actor_id',current_row->>'room_id') IS DISTINCT FROM (previous->>'actor_id',previous->>'room_id'),TG_OP='DELETE'); 
  RETURN NULL;
END;
$observation_audience_changed$;
REVOKE ALL ON FUNCTION public.daisy_observation_audience_changed() FROM PUBLIC;
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
    PERFORM public.daisy_advance_observation_header('channel',value->>'channel_id',false,
      TG_OP='DELETE' OR (current_row->>'removed_at' IS NOT NULL AND previous->>'removed_at' IS NULL));
  END IF;
  RETURN NULL;
END;
$observation_inbox_changed$;
REVOKE ALL ON FUNCTION public.daisy_observation_inbox_changed() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER daisy_inbox_messages ON public.messaging_messages;
CREATE TRIGGER daisy_channel_messages AFTER INSERT OR UPDATE OR DELETE ON public.messaging_messages FOR EACH ROW EXECUTE FUNCTION public.daisy_observation_inbox_changed();
