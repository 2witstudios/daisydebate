CREATE FUNCTION public.daisy_observation_resource_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $observation_resource_changed$
DECLARE
  previous jsonb := CASE WHEN TG_OP='INSERT' THEN NULL ELSE pg_catalog.to_jsonb(OLD) END;
  current_row jsonb := CASE WHEN TG_OP='DELETE' THEN NULL ELSE pg_catalog.to_jsonb(NEW) END;
  resource_id text := COALESCE(current_row->>'id',previous->>'id');
  disclose boolean;
BEGIN
  IF TG_OP='UPDATE' AND (current_row-'updated_at') IS NOT DISTINCT FROM (previous-'updated_at') THEN RETURN NULL; END IF;
  disclose := TG_OP<>'UPDATE' OR (current_row->>'visibility',current_row->>'status',current_row->>'host_actor_id',current_row->>'created_by_actor_id',current_row->>'policy_revision',current_row->>'authority_revision',current_row->>'lifecycle')
    IS DISTINCT FROM (previous->>'visibility',previous->>'status',previous->>'host_actor_id',previous->>'created_by_actor_id',previous->>'policy_revision',previous->>'authority_revision',previous->>'lifecycle');
  PERFORM public.daisy_advance_observation_header(TG_ARGV[0],resource_id,disclose,TG_OP='DELETE');
  RETURN NULL;
END;
$observation_resource_changed$;
REVOKE ALL ON FUNCTION public.daisy_observation_resource_changed() FROM PUBLIC;
CREATE TRIGGER daisy_room_observation AFTER INSERT OR UPDATE OR DELETE ON public.rooms FOR EACH ROW EXECUTE FUNCTION public.daisy_observation_resource_changed('room');
CREATE TRIGGER daisy_round_observation AFTER INSERT OR UPDATE OR DELETE ON public.rounds FOR EACH ROW EXECUTE FUNCTION public.daisy_observation_resource_changed('round');
CREATE TRIGGER daisy_channel_observation AFTER INSERT OR UPDATE OR DELETE ON public.messaging_channels FOR EACH ROW EXECUTE FUNCTION public.daisy_observation_resource_changed('channel');

CREATE FUNCTION public.daisy_observation_audience_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $observation_audience_changed$
DECLARE
  previous jsonb := CASE WHEN TG_OP='INSERT' THEN NULL ELSE pg_catalog.to_jsonb(OLD) END;
  current_row jsonb := CASE WHEN TG_OP='DELETE' THEN NULL ELSE pg_catalog.to_jsonb(NEW) END;
  resource_id text := COALESCE(current_row->>TG_ARGV[1],previous->>TG_ARGV[1]);
BEGIN
  IF TG_OP='UPDATE' AND current_row IS NOT DISTINCT FROM previous THEN RETURN NULL; END IF;
  PERFORM public.daisy_advance_observation_header(TG_ARGV[0],resource_id,true,TG_OP='DELETE');
  RETURN NULL;
END;
$observation_audience_changed$;
REVOKE ALL ON FUNCTION public.daisy_observation_audience_changed() FROM PUBLIC;
CREATE TRIGGER daisy_room_audience_observation AFTER INSERT OR UPDATE OR DELETE ON public.room_participants FOR EACH ROW EXECUTE FUNCTION public.daisy_observation_audience_changed('room','room_id');
CREATE TRIGGER daisy_round_audience_observation AFTER INSERT OR UPDATE OR DELETE ON public.round_participants FOR EACH ROW EXECUTE FUNCTION public.daisy_observation_audience_changed('round','round_id');
CREATE TRIGGER daisy_group_audience_observation AFTER INSERT OR UPDATE OR DELETE ON public.messaging_group_grants FOR EACH ROW EXECUTE FUNCTION public.daisy_observation_audience_changed('channel','channel_id');

REVOKE ALL ON public.resource_observation_headers FROM PUBLIC,daisy_web,daisy_realtime;
GRANT SELECT ON public.resource_observation_headers TO daisy_web;

CREATE FUNCTION public.daisy_observation_inbox_changed() RETURNS trigger
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
CREATE TRIGGER daisy_inbox_preferences AFTER INSERT OR UPDATE OR DELETE ON public.messaging_actor_states FOR EACH ROW EXECUTE FUNCTION public.daisy_observation_inbox_changed();
CREATE TRIGGER daisy_inbox_membership AFTER INSERT OR UPDATE OR DELETE ON public.messaging_group_grants FOR EACH ROW EXECUTE FUNCTION public.daisy_observation_inbox_changed();
CREATE TRIGGER daisy_inbox_invitation AFTER INSERT OR UPDATE OR DELETE ON public.messaging_group_invitations FOR EACH ROW EXECUTE FUNCTION public.daisy_observation_inbox_changed();
CREATE TRIGGER daisy_inbox_messages AFTER INSERT OR UPDATE OR DELETE ON public.messaging_messages FOR EACH ROW EXECUTE FUNCTION public.daisy_observation_inbox_changed();

DO $projection_role$ BEGIN
  IF NOT EXISTS(SELECT FROM pg_catalog.pg_roles WHERE rolname='daisy_projection') THEN CREATE ROLE daisy_projection NOLOGIN; END IF;
END $projection_role$;
GRANT USAGE ON SCHEMA public TO daisy_projection;
GRANT SELECT ON public.resource_observation_headers TO daisy_projection;
