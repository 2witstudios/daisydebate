-- Every deleter of a live session (sign-out, revoke, revoke-all, erasure, Better Auth's own adapter)
-- appends the realtime revocation control in the deleting transaction, so no path can forget it.
CREATE FUNCTION public.daisy_session_revoked_control() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $session_revoked_control$
DECLARE
  subject text;
  position_txid xid8;
  position_seq bigint;
BEGIN
  -- An expired session already has no authority; retention purges need no control.
  IF OLD.expires_at <= pg_catalog.clock_timestamp() THEN RETURN NULL; END IF;
  SELECT a.id INTO subject FROM public.actors a WHERE a.user_id = OLD.user_id AND a.kind = 'human';
  -- A user who never claimed a username has no realtime inbox to revoke.
  IF subject IS NULL THEN RETURN NULL; END IF;
  INSERT INTO public.outbox(topic, kind, version, payload)
    VALUES ('user:' || subject || ':inbox', 'session.revoked', 1,
      pg_catalog.jsonb_build_object('entityVersion', 1, 'kind', 'session.revoked', 'ids',
        CASE WHEN OLD.id ~ '^[a-z0-9]{24}$' THEN pg_catalog.jsonb_build_array(subject, OLD.id)
          ELSE pg_catalog.jsonb_build_array(subject) END))
    RETURNING txid, seq INTO position_txid, position_seq;
  PERFORM pg_catalog.pg_notify('outbox', position_txid::text || ':' || position_seq::text);
  RETURN NULL;
END;
$session_revoked_control$;
REVOKE ALL ON FUNCTION public.daisy_session_revoked_control() FROM PUBLIC;
CREATE TRIGGER daisy_session_revoked_control AFTER DELETE ON public.session
  FOR EACH ROW EXECUTE FUNCTION public.daisy_session_revoked_control();
