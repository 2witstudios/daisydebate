CREATE FUNCTION public.daisy_authorization_read_accounts(actor_ids text[])
RETURNS TABLE ("userId" text, "actorId" text, "member" boolean, "erased" boolean, "revision" integer)
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
  PERFORM u.id FROM public.users AS u JOIN public.actors AS a ON a.user_id = u.id
    WHERE a.id = ANY(actor_ids) ORDER BY u.id FOR SHARE OF u;
  -- VOLATILE plus READ COMMITTED rereads canonical facts after every lock wait.
  RETURN QUERY SELECT account.* FROM public.actors AS a
    CROSS JOIN LATERAL public.daisy_authorization_accounts(NULL::text[], a.user_id, false) AS account
    WHERE a.id = ANY(actor_ids) AND account."actorId" = a.id ORDER BY account."userId";
END;
$authorization_read_accounts$;
REVOKE ALL ON FUNCTION public.daisy_authorization_read_accounts(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.daisy_authorization_read_accounts(text[]) TO daisy_web, daisy_realtime;
