CREATE FUNCTION public.daisy_observation_actor_inbox_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp
AS $actor_inbox_changed$
BEGIN
  IF TG_OP='UPDATE' AND (NEW.kind,NEW.user_id) IS NOT DISTINCT FROM (OLD.kind,OLD.user_id) THEN RETURN NULL; END IF;
  PERFORM public.daisy_advance_observation_header('inbox',CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END,TG_OP<>'INSERT',TG_OP<>'INSERT');
  RETURN NULL;
END;
$actor_inbox_changed$;
REVOKE ALL ON FUNCTION public.daisy_observation_actor_inbox_changed() FROM PUBLIC;
CREATE TRIGGER daisy_actor_inbox_observation AFTER INSERT OR UPDATE OR DELETE ON public.actors FOR EACH ROW EXECUTE FUNCTION public.daisy_observation_actor_inbox_changed();

CREATE FUNCTION public.daisy_observation_dm_association_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp
AS $dm_association_changed$
DECLARE previous jsonb:=CASE WHEN TG_OP='INSERT' THEN NULL ELSE pg_catalog.to_jsonb(OLD) END;
  current_row jsonb:=CASE WHEN TG_OP='DELETE' THEN NULL ELSE pg_catalog.to_jsonb(NEW) END;
  subject text;
BEGIN
  IF TG_OP='UPDATE' AND (NEW.low_actor_id,NEW.high_actor_id,NEW.channel_id,NEW.request_state) IS NOT DISTINCT FROM (OLD.low_actor_id,OLD.high_actor_id,OLD.channel_id,OLD.request_state) THEN RETURN NULL; END IF;
  FOR subject IN SELECT DISTINCT id FROM pg_catalog.unnest(ARRAY[previous->>'low_actor_id',previous->>'high_actor_id',current_row->>'low_actor_id',current_row->>'high_actor_id']) ids(id) WHERE id IS NOT NULL ORDER BY id LOOP
    PERFORM public.daisy_advance_observation_header('inbox',subject,true,TG_OP='DELETE' OR current_row->>'request_state' IN ('declined','cancelled'));
  END LOOP;
  RETURN NULL;
END;
$dm_association_changed$;
REVOKE ALL ON FUNCTION public.daisy_observation_dm_association_changed() FROM PUBLIC;
CREATE TRIGGER daisy_dm_inbox_observation AFTER INSERT OR UPDATE OR DELETE ON public.messaging_dm_pairs FOR EACH ROW EXECUTE FUNCTION public.daisy_observation_dm_association_changed();

CREATE FUNCTION public.daisy_observation_contact_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp
AS $contact_changed$
DECLARE channel text; subject text;
BEGIN
  IF (NEW.low_blocks_high,NEW.high_blocks_low) IS NOT DISTINCT FROM (OLD.low_blocks_high,OLD.high_blocks_low) THEN RETURN NULL; END IF;
  FOR subject IN SELECT id FROM pg_catalog.unnest(ARRAY[NEW.low_actor_id,NEW.high_actor_id]) ids(id) ORDER BY id LOOP
    PERFORM public.daisy_advance_observation_header('inbox',subject,true,NEW.low_blocks_high OR NEW.high_blocks_low);
  END LOOP;
  SELECT channel_id INTO channel FROM public.messaging_dm_pairs WHERE low_actor_id=NEW.low_actor_id AND high_actor_id=NEW.high_actor_id;
  IF channel IS NOT NULL THEN PERFORM public.daisy_advance_observation_header('channel',channel,true,NEW.low_blocks_high OR NEW.high_blocks_low); END IF;
  RETURN NULL;
END;
$contact_changed$;
REVOKE ALL ON FUNCTION public.daisy_observation_contact_changed() FROM PUBLIC;
CREATE TRIGGER daisy_contact_observation AFTER UPDATE ON public.messaging_contact_pairs FOR EACH ROW EXECUTE FUNCTION public.daisy_observation_contact_changed();
