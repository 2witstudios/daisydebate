CREATE TABLE "spectator_fact_log_open_rounds" (
	"round_id" text PRIMARY KEY,
	"touched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "spectator_fact_log_open_rounds" ADD CONSTRAINT "spectator_fact_log_open_rounds_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "spectator_fact_releases" DROP CONSTRAINT "spectator_fact_releases_kind_check", ADD CONSTRAINT "spectator_fact_releases_kind_check" CHECK ("kind" in ('stage', 'resolution', 'result', 'ballot', 'rating', 'caption'));--> statement-breakpoint
-- A fact-log row opens from a Round's own change or from any fact of it, locking
-- and touching an existing row so a concurrent removal waits and then leaves it.
CREATE FUNCTION open_spectator_fact_log(of_round text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO spectator_fact_log_open_rounds (round_id, touched_at)
  VALUES (of_round, clock_timestamp())
  ON CONFLICT (round_id) DO UPDATE SET touched_at = clock_timestamp();
$$;
--> statement-breakpoint
CREATE FUNCTION open_spectator_fact_log_of_round() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM open_spectator_fact_log(NEW.id);
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE FUNCTION open_spectator_fact_log_of_fact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM open_spectator_fact_log(NEW.round_id);
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER rounds_open_fact_log_on_insert
  AFTER INSERT ON rounds FOR EACH ROW
  WHEN (NEW.room_id IS NOT NULL AND NEW.visibility IN ('public','unlisted'))
  EXECUTE FUNCTION open_spectator_fact_log_of_round();
--> statement-breakpoint
CREATE TRIGGER rounds_open_fact_log_on_update
  AFTER UPDATE OF status, visibility, room_id ON rounds FOR EACH ROW
  WHEN (NEW.room_id IS NOT NULL AND NEW.visibility IN ('public','unlisted')
    AND (OLD.status IS DISTINCT FROM NEW.status
      OR OLD.visibility IS DISTINCT FROM NEW.visibility
      OR OLD.room_id IS DISTINCT FROM NEW.room_id))
  EXECUTE FUNCTION open_spectator_fact_log_of_round();
--> statement-breakpoint
CREATE TRIGGER rating_changes_open_fact_log
  AFTER INSERT ON rating_changes FOR EACH ROW
  EXECUTE FUNCTION open_spectator_fact_log_of_fact();
--> statement-breakpoint
CREATE TRIGGER ballots_open_fact_log
  AFTER INSERT ON ballots FOR EACH ROW
  EXECUTE FUNCTION open_spectator_fact_log_of_fact();
--> statement-breakpoint
CREATE TRIGGER utterances_open_fact_log
  AFTER INSERT OR UPDATE OF complete ON utterances FOR EACH ROW
  WHEN (NEW.complete)
  EXECUTE FUNCTION open_spectator_fact_log_of_fact();
--> statement-breakpoint
INSERT INTO spectator_fact_log_open_rounds (round_id, touched_at)
  SELECT id, clock_timestamp() FROM rounds
  WHERE room_id IS NOT NULL AND visibility IN ('public','unlisted');
