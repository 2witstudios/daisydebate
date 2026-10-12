CREATE FUNCTION public.daisy_authorization_ages(actor_ids text[],checked_at timestamptz)
RETURNS TABLE("actorId" text,band text,revision integer,"accountRevision" integer,"validUntil" timestamptz)
LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER SET search_path=pg_catalog,pg_temp
AS $authorization_ages$
BEGIN
  IF pg_catalog.cardinality(actor_ids) NOT BETWEEN 1 AND 4096 OR checked_at IS NULL OR NOT pg_catalog.isfinite(checked_at)
    OR EXTRACT(YEAR FROM checked_at AT TIME ZONE 'UTC') NOT BETWEEN 1000 AND 9999 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid authorization age selector';
  END IF;
  PERFORM 1 FROM public.daisy_authorization_read_accounts(actor_ids);
  RETURN QUERY SELECT a.id,
    CASE WHEN classified.age_months<156 THEN 'under-13' WHEN classified.age_months<192 THEN '13-15' WHEN classified.age_months<216 THEN '16-17' ELSE 'adult' END,
    age_source.version,account.revision,
    (pg_catalog.date_trunc('month',checked_at AT TIME ZONE 'UTC')+INTERVAL '1 month') AT TIME ZONE 'UTC'
  FROM public.actors a
  CROSS JOIN LATERAL public.daisy_authorization_accounts(NULL::text[],a.user_id,false) account
  JOIN public.account_age age_source ON age_source.user_id=account."userId"
  CROSS JOIN LATERAL(SELECT EXTRACT(YEAR FROM checked_at AT TIME ZONE 'UTC')::integer*12+EXTRACT(MONTH FROM checked_at AT TIME ZONE 'UTC')::integer
    -pg_catalog.split_part(age_source.birth_month,'-',1)::integer*12-pg_catalog.split_part(age_source.birth_month,'-',2)::integer AS age_months) classified
  WHERE a.id=ANY(actor_ids) AND account."actorId"=a.id AND account.member AND NOT account.erased AND age_source.version>0
    AND pg_catalog.isfinite(age_source.recorded_at) AND age_source.recorded_at<=checked_at AND classified.age_months>=0 ORDER BY a.id;
END;
$authorization_ages$;
REVOKE ALL ON FUNCTION public.daisy_authorization_ages(text[],timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.daisy_authorization_ages(text[],timestamptz) TO daisy_web,daisy_realtime;

--> statement-breakpoint
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

--> statement-breakpoint
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
