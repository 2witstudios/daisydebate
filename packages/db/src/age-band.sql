-- ADR 0075: the one validity and classification rule for a durable age
-- record, shared by the age reader and the account fence. A record counts
-- only with a positive version, a finite recorded time no later than the
-- evaluation instant, and a birth month not after it; otherwise NULL.
-- Bands match @daisy/auth ageBand. Pure: no table access, birth data in,
-- band out, so it never widens what a caller can read. Total: any NULL
-- input is no record (ISSUE-676), never a fall-through to adult.
CREATE FUNCTION public.daisy_age_band(
  birth_month text, version integer, recorded_at timestamptz, checked_at timestamptz
) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, pg_temp
AS $age_band$
  SELECT CASE
    WHEN birth_month IS NULL OR version IS NULL OR version <= 0
      OR recorded_at IS NULL OR checked_at IS NULL
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
REVOKE ALL ON FUNCTION public.daisy_age_band(text, integer, timestamptz, timestamptz) FROM PUBLIC;
