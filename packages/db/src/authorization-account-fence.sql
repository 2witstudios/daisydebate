-- Canonical account fact producer (v2, ADR 0075). CAP copies this input into one reviewed forward migration.
-- Create/revoke/grant run in the migration folder's single transaction; never as live production commands.
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
REVOKE ALL ON FUNCTION public.daisy_authorization_accounts_v2(text[], text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.daisy_authorization_accounts_v2(text[], text, boolean) TO daisy_web, daisy_realtime;

-- Expand step (ADR 0075): the five-column contract live v1 callers prepared
-- against keeps its exact result type, computed from the one v2 producer.
-- The contract step drops it once no instance calls it.
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
