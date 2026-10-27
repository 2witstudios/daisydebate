-- Canonical minimal account-age producer. Classification matches existing ageBand/WAIT4.8.
-- Bands are facts, not consent, collection authority, contact eligibility or policy approval.
-- CAP alone installs this input in one atomic reviewed forward migration.
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
REVOKE ALL ON FUNCTION public.daisy_authorization_age(text, text, integer, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.daisy_authorization_age(text, text, integer, timestamptz) TO daisy_web, daisy_realtime;
