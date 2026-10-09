-- Canonical account fact producer. CAP copies this input into one reviewed forward migration.
-- Create/revoke/grant run in the migration folder's single transaction; never as live production commands.
CREATE FUNCTION public.daisy_authorization_accounts(
  actor_ids text[], account_user_id text, take_fence boolean
) RETURNS TABLE ("userId" text, "actorId" text, "member" boolean, "erased" boolean, "revision" integer)
LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $authorization_accounts$
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
  -- A new statement after lock waits reevaluates membership and tombstone state.
  RETURN QUERY SELECT u.id,
    CASE WHEN a.kind = 'human' AND a.user_id = u.id THEN a.id ELSE NULL::text END,
    COALESCE(a.kind = 'human' AND a.user_id = u.id AND a.id IS NOT NULL
      AND u.email_verified AND u.username IS NOT NULL AND pg_catalog.length(u.username) > 0
      AND u.deleted_at IS NULL, false),
    u.deleted_at IS NOT NULL, u.version
    FROM public.users AS u LEFT JOIN public.actors AS a ON a.user_id = u.id
    WHERE (account_user_id IS NOT NULL AND u.id = account_user_id)
      OR (actor_ids IS NOT NULL AND a.id = ANY(actor_ids))
    ORDER BY u.id;
END;
$authorization_accounts$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_authorization_accounts(text[], text, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_authorization_accounts(text[], text, boolean) TO daisy_web, daisy_realtime;
