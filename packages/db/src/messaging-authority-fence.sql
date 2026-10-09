-- MSG lock producer. CAP installs this input in one reviewed forward migration.
-- No gateway UPDATE privilege, content projection or authority decision is granted.
CREATE FUNCTION public.daisy_messaging_channel_fence(
  requested_channel_id text, expected_low_actor_id text, expected_high_actor_id text
) RETURNS boolean
LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $messaging_channel_fence$
DECLARE
  channel_kind text;
  actual_low_actor_id text;
  actual_high_actor_id text;
BEGIN
  IF requested_channel_id IS NULL OR requested_channel_id !~ '^[a-z0-9]{24}$'
    OR (expected_low_actor_id IS NULL) <> (expected_high_actor_id IS NULL)
    OR (expected_low_actor_id IS NOT NULL AND (
      expected_low_actor_id !~ '^[a-z0-9]{24}$' OR expected_high_actor_id !~ '^[a-z0-9]{24}$'
      OR expected_low_actor_id >= expected_high_actor_id
    )) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid messaging fence selector';
  END IF;
  SELECT c.kind, d.low_actor_id, d.high_actor_id
    INTO channel_kind, actual_low_actor_id, actual_high_actor_id
    FROM public.messaging_channels AS c
    LEFT JOIN public.messaging_dm_pairs AS d ON d.channel_id = c.id
    WHERE c.id = requested_channel_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF channel_kind = 'dm' THEN
    IF actual_low_actor_id IS NULL OR actual_high_actor_id IS NULL
      OR actual_low_actor_id IS DISTINCT FROM expected_low_actor_id
      OR actual_high_actor_id IS DISTINCT FROM expected_high_actor_id
    THEN RETURN false; END IF;
    -- Canonical account locks are already held by the same caller transaction.
    PERFORM p.low_actor_id FROM public.messaging_contact_pairs AS p
      WHERE p.low_actor_id = actual_low_actor_id AND p.high_actor_id = actual_high_actor_id
      FOR UPDATE OF p;
    IF NOT FOUND THEN RETURN false; END IF;
  ELSIF channel_kind <> 'private_group' OR expected_low_actor_id IS NOT NULL THEN
    RETURN false;
  END IF;
  PERFORM c.id FROM public.messaging_channels AS c
    WHERE c.id = requested_channel_id FOR UPDATE OF c;
  RETURN FOUND;
END;
$messaging_channel_fence$;
REVOKE ALL ON FUNCTION public.daisy_messaging_channel_fence(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.daisy_messaging_channel_fence(text, text, text) TO daisy_web, daisy_realtime;
