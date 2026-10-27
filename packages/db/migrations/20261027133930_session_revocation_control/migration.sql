-- G6 (MSG-2.1-arch1): every session deletion announces itself in the deleting
-- transaction. Better Auth's sign-out and single-session revoke, Daisy's
-- revoke-all, the sign-in address check and the restore purge all delete
-- live `session` rows; one trigger appends the exact `session.revoked`
-- control for each deleted live session, so a crash
-- between the delete and an application append can no longer lose it, and a
-- failed append rolls the delete back. The control names the actor and the
-- session (`ids: [actorId, sessionId]`), so realtime closes only that
-- session's sockets. A user with no actor (never claimed a username) has no
-- realtime presence and appends nothing, which also covers the only account
-- delete there is (a provisional user; `actors.user_id` RESTRICTs deleting a
-- user who has one). A session already past its expiry announces nothing:
-- realtime refuses it at admission and revalidation, so the expiry sweep
-- adds no outbox rows. A statement-level trigger over the deleted rows'
-- transition table: a bulk delete costs one insert and one notification.
--
-- SECURITY INVOKER: the deleting role already inserts outbox rows and reads
-- actors; the trigger grants nothing new. It takes no parent lock after the
-- child delete (the actor read is a plain snapshot read), so it cannot invert
-- the account -> session lock order revoke-all relies on.
CREATE FUNCTION public.daisy_session_revoked_control()
RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  appended_txid xid8;
  appended_seq bigint;
BEGIN
  -- One statement however many sessions it deleted: one insert, one wake-up.
  WITH appended AS (
    INSERT INTO public.outbox (topic, kind, version, payload)
    SELECT 'user:' || a.id || ':inbox', 'session.revoked', 1,
      jsonb_build_object(
        'entityVersion', 1,
        'kind', 'session.revoked',
        'ids', jsonb_build_array(a.id, revoked.id)
      )
    FROM revoked_sessions AS revoked
    JOIN public.actors AS a ON a.user_id = revoked.user_id
    WHERE revoked.expires_at > pg_catalog.statement_timestamp()
    ORDER BY revoked.id
    RETURNING txid, seq
  )
  SELECT appended.txid, max(appended.seq) INTO appended_txid, appended_seq
  FROM appended GROUP BY appended.txid;
  IF appended_seq IS NOT NULL THEN
    PERFORM pg_notify('outbox', appended_txid::text || ':' || appended_seq::text);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_session_revoked_control() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER session_revoked_control
AFTER DELETE ON public.session
REFERENCING OLD TABLE AS revoked_sessions
FOR EACH STATEMENT EXECUTE FUNCTION public.daisy_session_revoked_control();
