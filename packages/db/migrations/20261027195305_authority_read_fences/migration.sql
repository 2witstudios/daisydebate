-- G4 (MSG-2.1-arch1): read-compatible authority fences. Readers take FOR SHARE
-- on the same rows, in the same order, as the exclusive writer fences, so
-- peer readers never serialize while any account/pair/channel writer still
-- waits for them and they for it. Additive: writers keep
-- daisy_authorization_accounts_v2(...,true) and daisy_messaging_channel_fence.
-- Built on BETA-2C (#471): v1 fence functions are gone, the age reader is on v2.

CREATE FUNCTION public.daisy_authorization_read_accounts_v2(actor_ids text[])
RETURNS TABLE ("userId" text, "actorId" text, "member" boolean, "erased" boolean, "revision" integer,
  "betaState" text, "betaRevision" integer, "ageBand" text)
LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $authorization_read_accounts$
BEGIN
  IF pg_catalog.array_ndims(actor_ids) IS DISTINCT FROM 1
    OR pg_catalog.array_lower(actor_ids, 1) IS DISTINCT FROM 1
    OR pg_catalog.cardinality(actor_ids) NOT BETWEEN 1 AND 65535
    OR EXISTS (SELECT 1 FROM pg_catalog.unnest(actor_ids) AS requested(id)
      WHERE requested.id IS NULL OR requested.id !~ '^[a-z0-9]{24}$')
    OR (SELECT pg_catalog.count(DISTINCT requested.id) FROM pg_catalog.unnest(actor_ids) AS requested(id)) <> pg_catalog.cardinality(actor_ids)
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid authorization read selector';
  END IF;
  -- The writer fence's rows and order, shared.
  PERFORM u.id FROM public.users AS u JOIN public.actors AS a ON a.user_id = u.id
    WHERE a.id = ANY(actor_ids) ORDER BY u.id FOR SHARE OF u;
  -- VOLATILE plus READ COMMITTED: a new statement rereads facts after the waits.
  RETURN QUERY SELECT account.* FROM public.actors AS a
    CROSS JOIN LATERAL public.daisy_authorization_accounts_v2(NULL::text[], a.user_id, false) AS account
    WHERE a.id = ANY(actor_ids) AND account."actorId" = a.id ORDER BY account."userId";
END;
$authorization_read_accounts$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_authorization_read_accounts_v2(text[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_authorization_read_accounts_v2(text[]) TO daisy_web, daisy_realtime;
--> statement-breakpoint
-- The age reader is a reader: its account fence becomes shared. A writer that
-- already holds the exclusive fence and then reads age takes a weaker lock it
-- already covers, never an upgrade.
CREATE OR REPLACE FUNCTION public.daisy_authorization_age(
  requested_user_id text, requested_actor_id text, account_revision integer, checked_at timestamptz
) RETURNS TABLE ("actorId" text, band text, revision integer, "accountRevision" integer, "validUntil" timestamptz)
LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $authorization_age$
BEGIN
  IF requested_user_id IS NULL OR requested_user_id !~ '^[a-z0-9]{24}$'
    OR requested_actor_id IS NULL OR requested_actor_id !~ '^[a-z0-9]{24}$'
    OR account_revision IS NULL OR account_revision <= 0
    OR checked_at IS NULL OR NOT pg_catalog.isfinite(checked_at)
    OR EXTRACT(YEAR FROM checked_at AT TIME ZONE 'UTC') NOT BETWEEN 1000 AND 9999
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid authorization age selector';
  END IF;
  PERFORM 1 FROM public.daisy_authorization_read_accounts_v2(ARRAY[requested_actor_id]);
  RETURN QUERY
    SELECT requested_actor_id, banded.band,
      age_source.version, account.revision,
      (pg_catalog.date_trunc('month', checked_at AT TIME ZONE 'UTC') + INTERVAL '1 month') AT TIME ZONE 'UTC'
    FROM public.daisy_authorization_accounts_v2(NULL::text[], requested_user_id, false) AS account
    JOIN public.account_age AS age_source ON age_source.user_id = account."userId"
    CROSS JOIN LATERAL (SELECT public.daisy_age_band(age_source.birth_month,
      age_source.version, age_source.recorded_at, checked_at) AS band) AS banded
    WHERE account."actorId" = requested_actor_id AND account.member AND NOT account.erased
      AND account.revision = account_revision AND banded.band IS NOT NULL;
END;
$authorization_age$;
--> statement-breakpoint
CREATE FUNCTION public.daisy_messaging_channel_read_fence(
  requested_channel_id text, expected_low_actor_id text, expected_high_actor_id text
) RETURNS boolean
LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $messaging_channel_read_fence$
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
    PERFORM p.low_actor_id FROM public.messaging_contact_pairs AS p
      WHERE p.low_actor_id = actual_low_actor_id AND p.high_actor_id = actual_high_actor_id
      FOR SHARE OF p;
    IF NOT FOUND THEN RETURN false; END IF;
  ELSIF channel_kind <> 'private_group' OR expected_low_actor_id IS NOT NULL THEN
    RETURN false;
  END IF;
  PERFORM c.id FROM public.messaging_channels AS c
    WHERE c.id = requested_channel_id FOR SHARE OF c;
  RETURN FOUND;
END;
$messaging_channel_read_fence$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_messaging_channel_read_fence(text, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_messaging_channel_read_fence(text, text, text) TO daisy_web, daisy_realtime;
