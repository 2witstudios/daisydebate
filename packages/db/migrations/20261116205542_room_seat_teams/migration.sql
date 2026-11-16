ALTER TABLE "room_participants" ADD COLUMN "team_open" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "room_participants" ADD COLUMN "position_open" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "team_one_side" text;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "seat_draw" jsonb;--> statement-breakpoint
ALTER TABLE "room_participants" ADD CONSTRAINT "room_participants_open_seat_check" CHECK (("role" <> 'judge' or not ("team_open" or "position_open")) and (not "team_open" or "position_open"));--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_team_one_side_check" CHECK ("team_one_side" is null or "team_one_side" in ('affirmative', 'negative'));--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_seat_draw_is_object" CHECK (jsonb_typeof("seat_draw") = 'object');--> statement-breakpoint
-- Existing Rooms keep the sides their seats were taken for (ADR 0143): only
-- Rooms created from now on default to a coin flip.
UPDATE "rooms" SET "team_one_side" = 'affirmative';--> statement-breakpoint
CREATE FUNCTION preserve_round_seat_draw() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.seat_draw IS NOT NULL AND NEW.seat_draw IS DISTINCT FROM OLD.seat_draw THEN
    RAISE EXCEPTION 'A Round''s seat draw is immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'rounds_seat_draw_immutable';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER rounds_seat_draw_immutable BEFORE UPDATE ON rounds
FOR EACH ROW EXECUTE FUNCTION preserve_round_seat_draw();
