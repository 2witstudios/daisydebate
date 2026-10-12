-- The projection role relays commit-ordered positions; only revocation controls carry a payload.
CREATE FUNCTION public.daisy_relay_outbox(after_txid xid8, after_seq bigint, page_limit integer)
RETURNS TABLE(seq bigint, txid xid8, topic text, kind text, version integer, payload jsonb, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $relay_outbox$
BEGIN
  IF after_txid IS NULL OR after_seq IS NULL OR page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 256 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid relay page';
  END IF;
  RETURN QUERY SELECT o.seq, o.txid, o.topic, o.kind, o.version,
      CASE WHEN o.kind IN ('session.revoked','access.revoked') THEN o.payload END,
      o.created_at
    FROM public.outbox o
    WHERE (o.txid, o.seq) > (after_txid, after_seq)
      AND o.txid < pg_catalog.pg_snapshot_xmin(pg_catalog.pg_current_snapshot())
    ORDER BY o.txid, o.seq
    LIMIT page_limit;
END;
$relay_outbox$;
REVOKE ALL ON FUNCTION public.daisy_relay_outbox(xid8,bigint,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.daisy_relay_outbox(xid8,bigint,integer) TO daisy_projection;

CREATE FUNCTION public.daisy_relay_outbox_high_water()
RETURNS TABLE(txid xid8, seq bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $relay_outbox_high_water$
  SELECT o.txid, o.seq FROM public.outbox o
  WHERE o.txid < pg_catalog.pg_snapshot_xmin(pg_catalog.pg_current_snapshot())
  ORDER BY o.txid DESC, o.seq DESC LIMIT 1;
$relay_outbox_high_water$;
REVOKE ALL ON FUNCTION public.daisy_relay_outbox_high_water() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.daisy_relay_outbox_high_water() TO daisy_projection;
