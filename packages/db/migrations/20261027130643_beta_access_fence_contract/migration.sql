-- BETA-2C (ADR 0075): the contract step for the account fence. Every web
-- and realtime caller has read daisy_authorization_accounts_v2 and
-- daisy_room_read_account_v2 since the gate release, and every instance now
-- runs it, so the v1 compatibility functions go. The age reader first moves
-- its own fence calls to v2 (same signature, so its grants stay).
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
  PERFORM 1 FROM public.daisy_authorization_accounts_v2(ARRAY[requested_actor_id], NULL::text, true);
  RETURN QUERY
    SELECT requested_actor_id, banded.band,
      age_source.version, account.revision,
      (pg_catalog.date_trunc('month', checked_at AT TIME ZONE 'UTC') + INTERVAL '1 month') AT TIME ZONE 'UTC'
    FROM public.daisy_authorization_accounts_v2(NULL::text[], requested_user_id, false) AS account
    JOIN public.account_age AS age_source ON age_source.user_id = account."userId"
    -- ADR 0075: the shared validity and classification rule (daisy_age_band).
    CROSS JOIN LATERAL (SELECT public.daisy_age_band(age_source.birth_month,
      age_source.version, age_source.recorded_at, checked_at) AS band) AS banded
    WHERE account."actorId" = requested_actor_id AND account.member AND NOT account.erased
      AND account.revision = account_revision AND banded.band IS NOT NULL;
END;
$authorization_age$;
--> statement-breakpoint
DROP FUNCTION public.daisy_room_read_account(text, text);
--> statement-breakpoint
DROP FUNCTION public.daisy_authorization_accounts(text[], text, boolean);
