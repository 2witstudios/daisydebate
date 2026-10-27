-- ISSUE-676 (astra N2 on BETA-2): the shared age validity helper is total.
-- A NULL birth month with an otherwise valid record classified as adult under
-- three-valued logic; it is now no record. Same signature and result type, so
-- CREATE OR REPLACE keeps every caller and the existing EXECUTE grants.
CREATE OR REPLACE FUNCTION public.daisy_age_band(
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
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_age_band(text, integer, timestamptz, timestamptz) FROM PUBLIC;
