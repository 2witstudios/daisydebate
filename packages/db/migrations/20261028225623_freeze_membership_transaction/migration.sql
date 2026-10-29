
--> statement-breakpoint
CREATE FUNCTION guard_finalization_membership_transaction() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM round_finalizations f WHERE f.round_id=NEW.round_id AND f.xmin::text::bigint = txid_current() % 4294967296) THEN
    RAISE EXCEPTION 'Result membership must freeze with its terminal transition';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER round_finalization_membership_transaction BEFORE INSERT ON round_finalization_ballots
FOR EACH ROW EXECUTE FUNCTION guard_finalization_membership_transaction();
