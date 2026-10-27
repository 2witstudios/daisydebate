-- ADR 0075 gate activation, expand step. New versioned producers
-- (daisy_authorization_accounts_v2, daisy_room_read_account_v2) report the
-- account's beta access and age band; the v1 functions keep their exact
-- five-column result, now computed from v2, so statements live instances
-- prepared against v1 stay valid. The age reader and the fence share one
-- age validity rule (daisy_age_band). A later contract step drops v1.
-- ADR 0075: the one validity and classification rule for a durable age
-- record, shared by the age reader and the account fence. A record counts
-- only with a positive version, a finite recorded time no later than the
-- evaluation instant, and a birth month not after it; otherwise NULL.
-- Bands match @daisy/auth ageBand. Pure: no table access, birth data in,
-- band out, so it never widens what a caller can read.
CREATE FUNCTION public.daisy_age_band(
  birth_month text, version integer, recorded_at timestamptz, checked_at timestamptz
) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $age_band$
  SELECT CASE
    WHEN version IS NULL OR version <= 0 OR recorded_at IS NULL OR checked_at IS NULL
      OR NOT pg_catalog.isfinite(recorded_at) OR NOT pg_catalog.isfinite(checked_at)
      OR recorded_at > checked_at OR birth_month !~ '^[1-9][0-9]{3}-(0[1-9]|1[0-2])$'
      OR age.months < 0 THEN NULL::text
    WHEN age.months < 156 THEN 'under-13'
    WHEN age.months < 192 THEN '13-15'
    WHEN age.months < 216 THEN '16-17'
    ELSE 'adult' END
  FROM (SELECT
    EXTRACT(YEAR FROM checked_at AT TIME ZONE 'UTC')::integer * 12
    + EXTRACT(MONTH FROM checked_at AT TIME ZONE 'UTC')::integer
    - CASE WHEN birth_month ~ '^[1-9][0-9]{3}-(0[1-9]|1[0-2])$'
        THEN pg_catalog.split_part(birth_month, '-', 1)::integer * 12
          + pg_catalog.split_part(birth_month, '-', 2)::integer END AS months) AS age
$age_band$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_age_band(text, integer, timestamptz, timestamptz) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.daisy_authorization_accounts_v2(
  actor_ids text[], account_user_id text, take_fence boolean
) RETURNS TABLE ("userId" text, "actorId" text, "member" boolean, "erased" boolean, "revision" integer,
  "betaState" text, "betaRevision" integer, "ageBand" text)
LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $authorization_accounts$
DECLARE
  checked timestamptz;
BEGIN
  IF take_fence IS NULL OR (actor_ids IS NULL) = (account_user_id IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid authorization account selector';
  END IF;
  IF actor_ids IS NOT NULL THEN
    IF take_fence IS NOT TRUE
      OR pg_catalog.array_ndims(actor_ids) IS DISTINCT FROM 1
      OR pg_catalog.array_lower(actor_ids, 1) IS DISTINCT FROM 1
      OR pg_catalog.cardinality(actor_ids) NOT BETWEEN 1 AND 65535
      OR EXISTS (SELECT 1 FROM pg_catalog.unnest(actor_ids) AS requested(id) WHERE requested.id IS NULL OR requested.id !~ '^[a-z0-9]{24}$')
      OR (SELECT pg_catalog.count(DISTINCT requested.id) FROM pg_catalog.unnest(actor_ids) AS requested(id)) <> pg_catalog.cardinality(actor_ids)
    THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid authorization account selector';
    END IF;
    -- The same user-row fence as erasure, correction and contact/channel commands.
    PERFORM u.id FROM public.users AS u JOIN public.actors AS a ON a.user_id = u.id
      WHERE a.id = ANY(actor_ids) ORDER BY u.id FOR UPDATE OF u;
  ELSE
    IF take_fence IS NOT FALSE OR account_user_id !~ '^[a-z0-9]{24}$' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid authorization account selector';
    END IF;
  END IF;
  -- A new statement after lock waits reevaluates membership and tombstone state,
  -- and the age band is classified at an instant sampled after those waits.
  checked := pg_catalog.clock_timestamp();
  RETURN QUERY SELECT u.id,
    CASE WHEN a.kind = 'human' AND a.user_id = u.id THEN a.id ELSE NULL::text END,
    COALESCE(a.kind = 'human' AND a.user_id = u.id AND a.id IS NOT NULL
      AND u.email_verified AND u.username IS NOT NULL AND pg_catalog.length(u.username) > 0
      AND u.deleted_at IS NULL, false),
    u.deleted_at IS NOT NULL, u.version,
    -- ADR 0075: the account's own beta access, under the same fence.
    b.state, b.revision,
    -- ADR 0075: the account's age band at a fresh post-wait instant, by the
    -- shared validity rule; never birth data. Null without a valid record
    -- or for an erased account.
    CASE WHEN u.deleted_at IS NOT NULL THEN NULL::text
      ELSE public.daisy_age_band(ag.birth_month, ag.version, ag.recorded_at, checked) END
    FROM public.users AS u LEFT JOIN public.actors AS a ON a.user_id = u.id
    LEFT JOIN public.account_beta_access AS b ON b.user_id = u.id
    LEFT JOIN public.account_age AS ag ON ag.user_id = u.id
    WHERE (account_user_id IS NOT NULL AND u.id = account_user_id)
      OR (actor_ids IS NOT NULL AND a.id = ANY(actor_ids))
    ORDER BY u.id;
END;
$authorization_accounts$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_authorization_accounts_v2(text[], text, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_authorization_accounts_v2(text[], text, boolean) TO daisy_web, daisy_realtime;

-- Expand step (ADR 0075): the five-column contract live v1 callers prepared
-- against keeps its exact result type, computed from the one v2 producer.
-- The contract step drops it once no instance calls it.
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.daisy_authorization_accounts(
  actor_ids text[], account_user_id text, take_fence boolean
) RETURNS TABLE ("userId" text, "actorId" text, "member" boolean, "erased" boolean, "revision" integer)
LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $authorization_accounts$
BEGIN
  RETURN QUERY SELECT v2."userId", v2."actorId", v2."member", v2."erased", v2."revision"
    FROM public.daisy_authorization_accounts_v2(actor_ids, account_user_id, take_fence) AS v2;
END;
$authorization_accounts$;
--> statement-breakpoint
CREATE FUNCTION public.daisy_room_read_account_v2(requested_actor_id text, requested_user_id text)
RETURNS TABLE ("userId" text, "actorId" text, "member" boolean, "erased" boolean, "revision" integer,
  "betaState" text, "betaRevision" integer, "ageBand" text)
LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $room_read_account$
BEGIN
  IF requested_actor_id IS NULL OR requested_user_id IS NULL
    OR requested_actor_id !~ '^[a-z0-9]{24}$' OR requested_user_id !~ '^[a-z0-9]{24}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid Room read account selector';
  END IF;
  -- SHARE permits peer readers but excludes UPDATE, DELETE and NO KEY UPDATE.
  -- One caller is the complete reader set; use the canonical user-id ordering.
  PERFORM u.id FROM public.users AS u JOIN public.actors AS a ON a.user_id = u.id
    WHERE a.id = requested_actor_id AND u.id = requested_user_id ORDER BY u.id FOR SHARE OF u;
  -- A fresh statement after the wait, never a pre-wait authorization snapshot.
  RETURN QUERY SELECT account.*
    FROM public.daisy_authorization_accounts_v2(NULL::text[], requested_user_id, false) AS account
    WHERE account."actorId" = requested_actor_id;
END;
$room_read_account$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_room_read_account_v2(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_room_read_account_v2(text, text) TO daisy_web, daisy_realtime;
--> statement-breakpoint
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
  -- Reuse the sole canonical account fence before reading the private age source.
  PERFORM 1 FROM public.daisy_authorization_accounts(ARRAY[requested_actor_id], NULL::text, true);
  RETURN QUERY
    SELECT requested_actor_id, banded.band,
      age_source.version, account.revision,
      (pg_catalog.date_trunc('month', checked_at AT TIME ZONE 'UTC') + INTERVAL '1 month') AT TIME ZONE 'UTC'
    FROM public.daisy_authorization_accounts(NULL::text[], requested_user_id, false) AS account
    JOIN public.account_age AS age_source ON age_source.user_id = account."userId"
    -- ADR 0075: the shared validity and classification rule (daisy_age_band).
    CROSS JOIN LATERAL (SELECT public.daisy_age_band(age_source.birth_month,
      age_source.version, age_source.recorded_at, checked_at) AS band) AS banded
    WHERE account."actorId" = requested_actor_id AND account.member AND NOT account.erased
      AND account.revision = account_revision AND banded.band IS NOT NULL;
END;
$authorization_age$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_authorization_age(text, text, integer, timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_authorization_age(text, text, integer, timestamptz) TO daisy_web, daisy_realtime;
