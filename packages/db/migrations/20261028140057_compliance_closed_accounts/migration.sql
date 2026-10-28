-- ADR 0087: a closed account keeps its username on the competitive record;
-- the CHECK still refuses an email, image or name on it. NOT VALID keeps the
-- users lock short; the relaxed rule cannot fail validation.
ALTER TABLE "users" DROP CONSTRAINT "users_tombstone_scrubbed", ADD CONSTRAINT "users_tombstone_scrubbed" CHECK ("deleted_at" is null or ("email" is null and "image" is null and "name" = '')) NOT VALID;
--> statement-breakpoint
ALTER TABLE "users" VALIDATE CONSTRAINT "users_tombstone_scrubbed";
--> statement-breakpoint
-- ADR 0087: erasure no longer rewrites resolutions, so a Round's draw copies
-- and a Room's drawn items are immutable; only their Round's or Room's own
-- deletion (the cascade) removes them.
CREATE FUNCTION refuse_round_draw_copy_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM rounds WHERE id = OLD.round_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'A Round draw copy is immutable'
    USING ERRCODE = '23514', CONSTRAINT = 'round_draw_copies_immutable';
END;
$$;
--> statement-breakpoint
DROP TRIGGER round_resolution_draw_texts_erasure_only ON round_resolution_draw_texts;
--> statement-breakpoint
DROP TRIGGER round_draw_private_inputs_erasure_only ON round_draw_private_inputs;
--> statement-breakpoint
DROP FUNCTION guard_round_draw_erasable();
--> statement-breakpoint
CREATE TRIGGER round_resolution_draw_texts_immutable BEFORE UPDATE OR DELETE ON round_resolution_draw_texts
FOR EACH ROW EXECUTE FUNCTION refuse_round_draw_copy_change();
--> statement-breakpoint
CREATE TRIGGER round_draw_private_inputs_immutable BEFORE UPDATE OR DELETE ON round_draw_private_inputs
FOR EACH ROW EXECUTE FUNCTION refuse_round_draw_copy_change();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_room_draw_children() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'A drawn resolution or strike is fixed once made'
    USING ERRCODE = '23514', CONSTRAINT = 'room_draw_children_immutable';
END;
$$;
