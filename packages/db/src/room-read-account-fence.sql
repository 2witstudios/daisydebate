-- Canonical standalone Room reader fence (v2, ADR 0075). Writers retain the exclusive account producer.
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
REVOKE ALL ON FUNCTION public.daisy_room_read_account_v2(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.daisy_room_read_account_v2(text, text) TO daisy_web, daisy_realtime;
