-- ADR 0098: a Round owns its strike and pre-round prep, and Start round is the
-- one start. One forward move: no Round is mid-opening afterwards, so the Room
-- draw tables go, and launched Rounds keep their copied seed, texts, inputs and
-- evidence. The locks make a command on the serving release wait for this commit.
LOCK TABLE "rooms", "rounds" IN SHARE ROW EXCLUSIVE MODE;--> statement-breakpoint
-- Nothing starts a scheduled Round any more. One past the old 15-minute start
-- horizon (DEC-214) is abandoned as maintenance would have, and so is a proof
-- Round with no Room and so no cast to start; the rest start now.
DELETE FROM "room_active_memberships" WHERE "room_id" IN (
  SELECT "room_id" FROM "rounds"
  WHERE "status" = 'scheduled' AND "room_id" IS NOT NULL
    AND "created_at" <= statement_timestamp() - interval '15 minutes'
);--> statement-breakpoint
UPDATE "rounds" SET
  "status" = 'abandoned', "completed_at" = statement_timestamp(),
  "version" = "version" + 1, "updated_at" = statement_timestamp()
WHERE "status" = 'scheduled' AND ("room_id" IS NULL OR "created_at" <= statement_timestamp() - interval '15 minutes');--> statement-breakpoint
UPDATE "rounds" SET
  "status" = 'active', "current_stage" = 'countdown', "started_at" = statement_timestamp(),
  "version" = "version" + 1, "updated_at" = statement_timestamp()
WHERE "status" = 'scheduled';--> statement-breakpoint
DROP TRIGGER "rooms_topic_matches_draw" ON "rooms";--> statement-breakpoint
-- An open Room that had begun a draw or prep starts over, with Ready cleared by
-- the new version: a begun pre-round no longer exists to resume.
UPDATE "rooms" SET
  "topic" = CASE WHEN coalesce("execution_plan"->'resolutionDraw'->>'enabled' = 'true', false) THEN NULL ELSE "topic" END,
  "version" = "version" + 1, "change_version" = "change_version" + 1, "updated_at" = statement_timestamp()
WHERE "status" IN ('assembling', 'ready') AND (
  "prep_started_at" IS NOT NULL
  OR EXISTS (SELECT 1 FROM "room_resolution_draws" d WHERE d."room_id" = "rooms"."id")
);--> statement-breakpoint
SET CONSTRAINTS ALL IMMEDIATE;--> statement-breakpoint
CREATE TABLE "round_resolution_draw_items" (
	"draw_id" text,
	"position" integer,
	"source_kind" text NOT NULL,
	"draw_size" integer NOT NULL,
	"candidate_id" text NOT NULL,
	"bank_entry_id" text,
	"category" text,
	CONSTRAINT "round_resolution_draw_items_pkey" PRIMARY KEY("draw_id","position"),
	CONSTRAINT "round_resolution_draw_items_bank_entry_check" CHECK (("source_kind" = 'bank') = ("bank_entry_id" is not null)),
	CONSTRAINT "round_resolution_draw_items_position_check" CHECK ("position" >= 0 and "position" < "draw_size"),
	CONSTRAINT "round_resolution_draw_items_category_check" CHECK ("category" is null or "category" in ('policy', 'value', 'fact'))
);
--> statement-breakpoint
CREATE TABLE "round_resolution_draws" (
	"id" text PRIMARY KEY,
	"round_id" text NOT NULL UNIQUE,
	"source_kind" text NOT NULL,
	"draw_size" integer NOT NULL,
	"manifest" jsonb NOT NULL,
	"manifest_digest" text NOT NULL,
	"commitment" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	CONSTRAINT "round_resolution_draws_kind_unique" UNIQUE("id","source_kind"),
	CONSTRAINT "round_resolution_draws_size_unique" UNIQUE("id","draw_size"),
	CONSTRAINT "round_resolution_draws_source_kind_check" CHECK ("source_kind" in ('bank', 'host')),
	CONSTRAINT "round_resolution_draws_manifest_match" CHECK ("manifest"->'source'->>'kind' = "source_kind" and ("manifest"->>'drawSize')::int = "draw_size"),
	CONSTRAINT "round_resolution_draws_size_check" CHECK ("draw_size" between 2 and 20),
	CONSTRAINT "round_resolution_draws_digest_hex" CHECK ("manifest_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "round_resolution_draws_commitment_hex" CHECK ("commitment" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "round_resolution_draws_manifest_is_object" CHECK (jsonb_typeof("manifest") = 'object')
);
--> statement-breakpoint
CREATE TABLE "round_resolution_strikes" (
	"draw_id" text,
	"ordinal" integer,
	"position" integer NOT NULL,
	"draw_size" integer NOT NULL,
	"side" text NOT NULL,
	"kind" text NOT NULL,
	"actor_id" text,
	"command_id" text,
	"struck_at" timestamp with time zone NOT NULL,
	CONSTRAINT "round_resolution_strikes_pkey" PRIMARY KEY("draw_id","ordinal"),
	CONSTRAINT "round_resolution_strikes_position_unique" UNIQUE("draw_id","position"),
	CONSTRAINT "round_resolution_strikes_ordinal_check" CHECK ("ordinal" >= 0 and "ordinal" < "draw_size" - 1),
	CONSTRAINT "round_resolution_strikes_side_check" CHECK ("side" in ('affirmative', 'negative')),
	CONSTRAINT "round_resolution_strikes_kind_check" CHECK ("kind" in ('debater', 'timeout', 'automatic')),
	CONSTRAINT "round_resolution_strikes_debater_check" CHECK (("kind" = 'debater') = ("actor_id" is not null and "command_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "room_resolution_draw_inputs" DROP CONSTRAINT "room_resolution_draw_inputs_x41u1vBnqo45_fkey";--> statement-breakpoint
ALTER TABLE "room_resolution_draw_items" DROP CONSTRAINT "room_resolution_draw_items_kind_fk";--> statement-breakpoint
ALTER TABLE "room_resolution_draw_items" DROP CONSTRAINT "room_resolution_draw_items_size_fk";--> statement-breakpoint
ALTER TABLE "room_resolution_strikes" DROP CONSTRAINT "room_resolution_strikes_item_fk";--> statement-breakpoint
ALTER TABLE "room_resolution_strikes" DROP CONSTRAINT "room_resolution_strikes_size_fk";--> statement-breakpoint
DROP TABLE "room_resolution_draw_inputs";--> statement-breakpoint
DROP TABLE "room_resolution_draw_items";--> statement-breakpoint
DROP TABLE "room_resolution_draws";--> statement-breakpoint
DROP TABLE "room_resolution_strikes";--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "pre_round_prep_ms" integer;--> statement-breakpoint
ALTER TABLE "rooms" DROP COLUMN "prep_started_at";--> statement-breakpoint
ALTER TABLE "rooms" DROP COLUMN "prep_remaining_ms";--> statement-breakpoint
ALTER TABLE "rounds" ALTER COLUMN "resolution" DROP NOT NULL;--> statement-breakpoint
DROP INDEX "rounds_discovery_live_room_idx";--> statement-breakpoint
CREATE INDEX "rounds_discovery_live_room_idx" ON "rounds" ("room_id" collate "C") WHERE "status" in ('opening', 'active') and "room_id" is not null;--> statement-breakpoint
CREATE INDEX "round_resolution_draw_items_kind_idx" ON "round_resolution_draw_items" ("draw_id","source_kind");--> statement-breakpoint
CREATE INDEX "round_resolution_draw_items_size_idx" ON "round_resolution_draw_items" ("draw_id","draw_size");--> statement-breakpoint
CREATE INDEX "round_resolution_draw_items_bank_entry_idx" ON "round_resolution_draw_items" ("bank_entry_id");--> statement-breakpoint
CREATE INDEX "round_resolution_strikes_size_idx" ON "round_resolution_strikes" ("draw_id","draw_size");--> statement-breakpoint
CREATE INDEX "round_resolution_strikes_actor_idx" ON "round_resolution_strikes" ("actor_id");--> statement-breakpoint
ALTER TABLE "round_resolution_draw_items" ADD CONSTRAINT "round_resolution_draw_items_TvyVFdMPzsHU_fkey" FOREIGN KEY ("bank_entry_id") REFERENCES "resolution_bank_entries"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "round_resolution_draw_items" ADD CONSTRAINT "round_resolution_draw_items_kind_fk" FOREIGN KEY ("draw_id","source_kind") REFERENCES "round_resolution_draws"("id","source_kind") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "round_resolution_draw_items" ADD CONSTRAINT "round_resolution_draw_items_size_fk" FOREIGN KEY ("draw_id","draw_size") REFERENCES "round_resolution_draws"("id","draw_size") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "round_resolution_draws" ADD CONSTRAINT "round_resolution_draws_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "round_resolution_strikes" ADD CONSTRAINT "round_resolution_strikes_actor_id_actors_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "round_resolution_strikes" ADD CONSTRAINT "round_resolution_strikes_item_fk" FOREIGN KEY ("draw_id","position") REFERENCES "round_resolution_draw_items"("draw_id","position") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "round_resolution_strikes" ADD CONSTRAINT "round_resolution_strikes_size_fk" FOREIGN KEY ("draw_id","draw_size") REFERENCES "round_resolution_draws"("id","draw_size") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_pre_round_prep_positive" CHECK ("pre_round_prep_ms" is null or "pre_round_prep_ms" > 0);--> statement-breakpoint
ALTER TABLE "round_commands" DROP CONSTRAINT "round_commands_type_check", ADD CONSTRAINT "round_commands_type_check" CHECK ("type" in ('start', 'strike_resolution', 'start_prep', 'start_speech', 'yield', 'interrupt', 'forfeit', 'complete', 'submit_ballot', 'check_in', 'adjudicate'));--> statement-breakpoint
ALTER TABLE "rounds" DROP CONSTRAINT "rounds_status_check", ADD CONSTRAINT "rounds_status_check" CHECK ("status" in ('opening', 'active', 'completed', 'abandoned'));--> statement-breakpoint
ALTER TABLE "rounds" DROP CONSTRAINT "rounds_lifecycle_check", ADD CONSTRAINT "rounds_lifecycle_check" CHECK (("status" = 'opening' and "current_stage" is null and "outcome" is null and "started_at" is null and "completed_at" is null) or ("status" = 'active' and "resolution" is not null and "current_stage" is not null and "outcome" is null and "started_at" is not null and "completed_at" is null) or ("status" = 'completed' and "current_stage" is null and "started_at" is not null and "completed_at" is not null) or ("status" = 'abandoned' and "current_stage" is null and "outcome" is null and "completed_at" is not null));--> statement-breakpoint
DROP FUNCTION check_room_topic_matches_draw();--> statement-breakpoint
DROP FUNCTION refuse_room_resolution_draw_update();--> statement-breakpoint
DROP FUNCTION guard_room_draw_children();--> statement-breakpoint
-- A draw is fixed once made; only its Round's own deletion removes its rows.
CREATE FUNCTION guard_round_draw() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM rounds WHERE id = OLD.round_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'A draw is immutable'
    USING ERRCODE = '23514', CONSTRAINT = 'round_resolution_draws_immutable';
END;
$$;--> statement-breakpoint
CREATE TRIGGER round_resolution_draws_immutable BEFORE UPDATE OR DELETE ON round_resolution_draws
FOR EACH ROW EXECUTE FUNCTION guard_round_draw();--> statement-breakpoint
CREATE FUNCTION guard_round_draw_children() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM round_resolution_draws WHERE id = OLD.draw_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'A drawn resolution or strike is fixed once made'
    USING ERRCODE = '23514', CONSTRAINT = 'round_draw_children_immutable';
END;
$$;--> statement-breakpoint
CREATE TRIGGER round_resolution_draw_items_immutable BEFORE UPDATE OR DELETE ON round_resolution_draw_items
FOR EACH ROW EXECUTE FUNCTION guard_round_draw_children();--> statement-breakpoint
CREATE TRIGGER round_resolution_strikes_immutable BEFORE UPDATE OR DELETE ON round_resolution_strikes
FOR EACH ROW EXECUTE FUNCTION guard_round_draw_children();
