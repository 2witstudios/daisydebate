-- G6 (MSG-2.1-arch1): every session deletion announces itself in the deleting
-- transaction. Better Auth's sign-out and single-session revoke, Daisy's
-- revoke-all, the sign-in address check, the expiry sweep, the restore purge
-- and a cascading account deletion all delete `session` rows; one row
-- trigger appends the exact `session.revoked` control for each, so a crash
-- between the delete and an application append can no longer lose it, and a
-- failed append rolls the delete back. The control names the actor and the
-- session (`ids: [actorId, sessionId]`), so realtime closes only that
-- session's sockets. A user with no actor (never claimed a username) has no
-- realtime presence and appends nothing.
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
  revoked_actor text;
  appended_txid xid8;
  appended_seq bigint;
BEGIN
  SELECT a.id INTO revoked_actor FROM public.actors a WHERE a.user_id = OLD.user_id;
  IF revoked_actor IS NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.outbox (topic, kind, version, payload)
  VALUES (
    'user:' || revoked_actor || ':inbox',
    'session.revoked',
    1,
    jsonb_build_object(
      'entityVersion', 1,
      'kind', 'session.revoked',
      'ids', jsonb_build_array(revoked_actor, OLD.id)
    )
  )
  RETURNING txid, seq INTO appended_txid, appended_seq;
  PERFORM pg_notify('outbox', appended_txid::text || ':' || appended_seq::text);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_session_revoked_control() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER session_revoked_control
AFTER DELETE ON public.session
FOR EACH ROW EXECUTE FUNCTION public.daisy_session_revoked_control();
