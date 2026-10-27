CREATE TABLE "resolution_bank_entries" (
	"id" text PRIMARY KEY,
	"text" text NOT NULL,
	"category" text NOT NULL,
	"difficulty" text NOT NULL,
	"locale" text NOT NULL,
	"provenance" text NOT NULL,
	"added_in_revision" integer NOT NULL,
	"retired_in_revision" integer,
	CONSTRAINT "resolution_bank_entries_category_check" CHECK ("category" in ('policy', 'value', 'fact')),
	CONSTRAINT "resolution_bank_entries_difficulty_check" CHECK ("difficulty" in ('intro', 'standard', 'advanced')),
	CONSTRAINT "resolution_bank_entries_text_check" CHECK (length(trim("text")) between 1 and 300),
	CONSTRAINT "resolution_bank_entries_retired_after_added" CHECK ("retired_in_revision" is null or "retired_in_revision" > "added_in_revision")
);
--> statement-breakpoint
CREATE TABLE "resolution_bank_revisions" (
	"revision" integer PRIMARY KEY,
	"note" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "room_resolution_draw_inputs" (
	"draw_id" text PRIMARY KEY,
	"inputs" jsonb NOT NULL,
	CONSTRAINT "room_resolution_draw_inputs_inputs_is_object" CHECK (jsonb_typeof("inputs") = 'object')
);
--> statement-breakpoint
CREATE TABLE "room_resolution_draw_items" (
	"draw_id" text,
	"position" integer,
	"source_kind" text NOT NULL,
	"draw_size" integer NOT NULL,
	"candidate_id" text NOT NULL,
	"bank_entry_id" text,
	"text" text NOT NULL,
	"category" text,
	CONSTRAINT "room_resolution_draw_items_pkey" PRIMARY KEY("draw_id","position"),
	CONSTRAINT "room_resolution_draw_items_bank_entry_check" CHECK (("source_kind" = 'bank') = ("bank_entry_id" is not null)),
	CONSTRAINT "room_resolution_draw_items_position_check" CHECK ("position" >= 0 and "position" < "draw_size")
);
--> statement-breakpoint
CREATE TABLE "room_resolution_draws" (
	"id" text PRIMARY KEY,
	"room_id" text NOT NULL UNIQUE,
	"source_kind" text NOT NULL,
	"draw_size" integer NOT NULL,
	"manifest" jsonb NOT NULL,
	"manifest_digest" text NOT NULL,
	"commitment" text NOT NULL,
	"seed" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	CONSTRAINT "room_resolution_draws_kind_unique" UNIQUE("id","source_kind"),
	CONSTRAINT "room_resolution_draws_size_unique" UNIQUE("id","draw_size"),
	CONSTRAINT "room_resolution_draws_source_kind_check" CHECK ("source_kind" in ('bank', 'host')),
	CONSTRAINT "room_resolution_draws_manifest_match" CHECK ("manifest"->'source'->>'kind' = "source_kind" and ("manifest"->>'drawSize')::int = "draw_size"),
	CONSTRAINT "room_resolution_draws_size_check" CHECK ("draw_size" between 2 and 20),
	CONSTRAINT "room_resolution_draws_seed_hex" CHECK ("seed" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "room_resolution_draws_digest_hex" CHECK ("manifest_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "room_resolution_draws_commitment_hex" CHECK ("commitment" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "room_resolution_draws_manifest_is_object" CHECK (jsonb_typeof("manifest") = 'object')
);
--> statement-breakpoint
CREATE TABLE "room_resolution_strikes" (
	"draw_id" text,
	"ordinal" integer,
	"position" integer NOT NULL,
	"draw_size" integer NOT NULL,
	"side" text NOT NULL,
	"kind" text NOT NULL,
	"actor_id" text,
	"command_id" text,
	"struck_at" timestamp with time zone NOT NULL,
	CONSTRAINT "room_resolution_strikes_pkey" PRIMARY KEY("draw_id","ordinal"),
	CONSTRAINT "room_resolution_strikes_position_unique" UNIQUE("draw_id","position"),
	CONSTRAINT "room_resolution_strikes_ordinal_check" CHECK ("ordinal" >= 0 and "ordinal" < "draw_size" - 1),
	CONSTRAINT "room_resolution_strikes_side_check" CHECK ("side" in ('affirmative', 'negative')),
	CONSTRAINT "room_resolution_strikes_kind_check" CHECK ("kind" in ('debater', 'timeout', 'automatic')),
	CONSTRAINT "room_resolution_strikes_debater_check" CHECK (("kind" = 'debater') = ("actor_id" is not null and "command_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "round_draw_private_inputs" (
	"round_id" text PRIMARY KEY,
	"inputs" jsonb NOT NULL,
	CONSTRAINT "round_draw_private_inputs_inputs_is_object" CHECK (jsonb_typeof("inputs") = 'object')
);
--> statement-breakpoint
CREATE TABLE "round_draw_seeds" (
	"round_id" text PRIMARY KEY,
	"seed" text NOT NULL,
	CONSTRAINT "round_draw_seeds_seed_hex" CHECK ("seed" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "round_resolution_draw_texts" (
	"round_id" text,
	"position" integer,
	"text" text NOT NULL,
	CONSTRAINT "round_resolution_draw_texts_pkey" PRIMARY KEY("round_id","position")
);
--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "last_command_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "resolution_evidence" jsonb;--> statement-breakpoint
ALTER TABLE "rooms" ALTER COLUMN "topic" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "resolution_bank_entries_added_idx" ON "resolution_bank_entries" ("added_in_revision");--> statement-breakpoint
CREATE INDEX "resolution_bank_entries_retired_idx" ON "resolution_bank_entries" ("retired_in_revision");--> statement-breakpoint
CREATE INDEX "room_resolution_draw_items_kind_idx" ON "room_resolution_draw_items" ("draw_id","source_kind");--> statement-breakpoint
CREATE INDEX "room_resolution_draw_items_size_idx" ON "room_resolution_draw_items" ("draw_id","draw_size");--> statement-breakpoint
CREATE INDEX "room_resolution_draw_items_bank_entry_idx" ON "room_resolution_draw_items" ("bank_entry_id");--> statement-breakpoint
CREATE INDEX "room_resolution_strikes_size_idx" ON "room_resolution_strikes" ("draw_id","draw_size");--> statement-breakpoint
CREATE INDEX "room_resolution_strikes_actor_idx" ON "room_resolution_strikes" ("actor_id");--> statement-breakpoint
ALTER TABLE "resolution_bank_entries" ADD CONSTRAINT "resolution_bank_entries_FGAsRWRioc6o_fkey" FOREIGN KEY ("added_in_revision") REFERENCES "resolution_bank_revisions"("revision") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "resolution_bank_entries" ADD CONSTRAINT "resolution_bank_entries_GRt3VnDWx9mF_fkey" FOREIGN KEY ("retired_in_revision") REFERENCES "resolution_bank_revisions"("revision") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "room_resolution_draw_inputs" ADD CONSTRAINT "room_resolution_draw_inputs_x41u1vBnqo45_fkey" FOREIGN KEY ("draw_id") REFERENCES "room_resolution_draws"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "room_resolution_draw_items" ADD CONSTRAINT "room_resolution_draw_items_yYfRJeit8DKX_fkey" FOREIGN KEY ("bank_entry_id") REFERENCES "resolution_bank_entries"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "room_resolution_draw_items" ADD CONSTRAINT "room_resolution_draw_items_kind_fk" FOREIGN KEY ("draw_id","source_kind") REFERENCES "room_resolution_draws"("id","source_kind") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "room_resolution_draw_items" ADD CONSTRAINT "room_resolution_draw_items_size_fk" FOREIGN KEY ("draw_id","draw_size") REFERENCES "room_resolution_draws"("id","draw_size") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "room_resolution_draws" ADD CONSTRAINT "room_resolution_draws_room_id_rooms_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "room_resolution_strikes" ADD CONSTRAINT "room_resolution_strikes_actor_id_actors_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "room_resolution_strikes" ADD CONSTRAINT "room_resolution_strikes_item_fk" FOREIGN KEY ("draw_id","position") REFERENCES "room_resolution_draw_items"("draw_id","position") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "room_resolution_strikes" ADD CONSTRAINT "room_resolution_strikes_size_fk" FOREIGN KEY ("draw_id","draw_size") REFERENCES "room_resolution_draws"("id","draw_size") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "round_draw_private_inputs" ADD CONSTRAINT "round_draw_private_inputs_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "round_draw_seeds" ADD CONSTRAINT "round_draw_seeds_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "round_resolution_draw_texts" ADD CONSTRAINT "round_resolution_draw_texts_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_fixed_topic_present" CHECK ("topic" is not null or "execution_plan"->'resolutionDraw'->>'enabled' = 'true');--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_resolution_evidence_is_object" CHECK (jsonb_typeof("resolution_evidence") = 'object');--> statement-breakpoint
ALTER TABLE "rooms" DROP CONSTRAINT "rooms_topic_nonempty", ADD CONSTRAINT "rooms_topic_nonempty" CHECK ("topic" is null or length(trim("topic")) > 0);
--> statement-breakpoint
-- FMT-7.1 (ADR 0076): one strict shape. Every stored config, plan, preset
-- and frozen snapshot declines the draw; every definition forbids it.
UPDATE "rooms" SET
  "config" = "config" || '{"resolutionDraw":{"enabled":false}}'::jsonb,
  "execution_plan" = "execution_plan" || '{"resolutionDraw":{"enabled":false}}'::jsonb;
--> statement-breakpoint
UPDATE "rounds" SET "room_config_snapshot" = "room_config_snapshot" || '{"resolutionDraw":{"enabled":false}}'::jsonb
  WHERE "room_config_snapshot" IS NOT NULL;
--> statement-breakpoint
UPDATE "format_presets" SET "config" = "config" || '{"resolutionDraw":{"enabled":false}}'::jsonb;
--> statement-breakpoint
UPDATE "format_revisions" SET "definition" = jsonb_set("definition", '{configurable,resolutionDraw}', 'null'::jsonb);
--> statement-breakpoint
-- The durable idle anchor. Receipts already purged cannot be recovered, so a
-- Room whose receipts were purged backfills earlier (ADR 0076, accepted).
UPDATE "rooms" SET "last_command_at" = greatest("created_at", coalesce(
  (SELECT max("applied_at") FROM "room_commands" c WHERE c."room_id" = "rooms"."id"),
  "created_at"));
--> statement-breakpoint
-- The curated bank: revision 1 rows only through the publication shape.
CREATE FUNCTION guard_resolution_bank_entry() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Bank entries are never deleted'
      USING ERRCODE = '23514', CONSTRAINT = 'resolution_bank_entries_append_only';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.text IS DISTINCT FROM OLD.text OR
     NEW.category IS DISTINCT FROM OLD.category OR NEW.difficulty IS DISTINCT FROM OLD.difficulty OR
     NEW.locale IS DISTINCT FROM OLD.locale OR NEW.provenance IS DISTINCT FROM OLD.provenance OR
     NEW.added_in_revision IS DISTINCT FROM OLD.added_in_revision OR
     OLD.retired_in_revision IS NOT NULL OR NEW.retired_in_revision IS NULL OR
     NEW.retired_in_revision <> (SELECT max(revision) FROM resolution_bank_revisions) THEN
    RAISE EXCEPTION 'A published bank entry only retires, once, at the newest revision'
      USING ERRCODE = '23514', CONSTRAINT = 'resolution_bank_entries_append_only';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER resolution_bank_entries_append_only
BEFORE UPDATE OR DELETE ON resolution_bank_entries
FOR EACH ROW EXECUTE FUNCTION guard_resolution_bank_entry();
--> statement-breakpoint
CREATE FUNCTION guard_resolution_bank_revision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.revision <> coalesce((SELECT max(revision) FROM resolution_bank_revisions), 0) + 1 THEN
      RAISE EXCEPTION 'Bank revisions are published in order'
        USING ERRCODE = '23514', CONSTRAINT = 'resolution_bank_revisions_append_only';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'A published bank revision is immutable'
    USING ERRCODE = '23514', CONSTRAINT = 'resolution_bank_revisions_append_only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER resolution_bank_revisions_append_only
BEFORE INSERT OR UPDATE OR DELETE ON resolution_bank_revisions
FOR EACH ROW EXECUTE FUNCTION guard_resolution_bank_revision();
--> statement-breakpoint
CREATE FUNCTION guard_resolution_bank_entry_added() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.added_in_revision <> (SELECT max(revision) FROM resolution_bank_revisions)
     OR NEW.retired_in_revision IS NOT NULL THEN
    RAISE EXCEPTION 'A bank entry joins only the newest revision'
      USING ERRCODE = '23514', CONSTRAINT = 'resolution_bank_entries_append_only';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER resolution_bank_entries_added_newest
BEFORE INSERT ON resolution_bank_entries
FOR EACH ROW EXECUTE FUNCTION guard_resolution_bank_entry_added();
--> statement-breakpoint
-- A Room's draw row is fixed at the draw.
CREATE FUNCTION refuse_room_resolution_draw_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'A draw is immutable'
    USING ERRCODE = '23514', CONSTRAINT = 'room_resolution_draws_immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER room_resolution_draws_immutable
BEFORE UPDATE ON room_resolution_draws
FOR EACH ROW EXECUTE FUNCTION refuse_room_resolution_draw_update();
--> statement-breakpoint
-- The topic follows the draw: null until the reveal, then the survivor's text.
-- Rechecked at commit for any change to the Room, its draw, items or strikes;
-- the parent Room is locked first, so stray child writes serialize with it.
CREATE FUNCTION check_room_topic_matches_draw() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target text;
  room rooms%ROWTYPE;
  draw room_resolution_draws%ROWTYPE;
  struck integer;
  survivor text;
BEGIN
  IF TG_TABLE_NAME = 'rooms' THEN
    target := coalesce(NEW.id, OLD.id);
  ELSIF TG_TABLE_NAME = 'room_resolution_draws' THEN
    target := coalesce(NEW.room_id, OLD.room_id);
  ELSE
    SELECT d.room_id INTO target FROM room_resolution_draws d
      WHERE d.id = coalesce(NEW.draw_id, OLD.draw_id);
  END IF;
  SELECT * INTO room FROM rooms WHERE id = target FOR UPDATE;
  IF NOT FOUND OR coalesce(room.execution_plan->'resolutionDraw'->>'enabled', 'false') <> 'true' THEN
    RETURN NULL;
  END IF;
  SELECT * INTO draw FROM room_resolution_draws WHERE room_id = target;
  IF FOUND THEN
    SELECT count(*) INTO struck FROM room_resolution_strikes WHERE draw_id = draw.id;
  END IF;
  IF NOT FOUND OR struck < draw.draw_size - 1 THEN
    IF room.topic IS NOT NULL THEN
      RAISE EXCEPTION 'A draw Room has no topic before its reveal'
        USING ERRCODE = '23514', CONSTRAINT = 'rooms_topic_matches_draw';
    END IF;
    RETURN NULL;
  END IF;
  SELECT i.text INTO survivor FROM room_resolution_draw_items i
    WHERE i.draw_id = draw.id AND NOT EXISTS (
      SELECT 1 FROM room_resolution_strikes s WHERE s.draw_id = draw.id AND s.position = i.position);
  IF room.topic IS DISTINCT FROM survivor THEN
    RAISE EXCEPTION 'A revealed draw Room''s topic is its surviving resolution'
      USING ERRCODE = '23514', CONSTRAINT = 'rooms_topic_matches_draw';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER rooms_topic_matches_draw
AFTER INSERT OR UPDATE ON rooms DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_room_topic_matches_draw();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER room_resolution_draws_topic_matches_draw
AFTER INSERT OR DELETE ON room_resolution_draws DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_room_topic_matches_draw();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER room_resolution_draw_items_topic_matches_draw
AFTER INSERT OR UPDATE OR DELETE ON room_resolution_draw_items DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_room_topic_matches_draw();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER room_resolution_strikes_topic_matches_draw
AFTER INSERT OR UPDATE OR DELETE ON room_resolution_strikes DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_room_topic_matches_draw();
--> statement-breakpoint
-- Round evidence: proof metadata and the seed never change; texts and
-- private inputs are never updated and are deleted only by the privacy
-- erasure operation. The setting is an accidental-write guard, not
-- authorization: authority is the authorized privacy operation.
CREATE FUNCTION preserve_round_resolution_evidence() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.resolution_evidence IS NOT NULL AND NEW.resolution_evidence IS DISTINCT FROM OLD.resolution_evidence THEN
    RAISE EXCEPTION 'Round resolution evidence is immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'rounds_resolution_evidence_immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER rounds_resolution_evidence_immutable BEFORE UPDATE ON rounds
FOR EACH ROW EXECUTE FUNCTION preserve_round_resolution_evidence();
--> statement-breakpoint
CREATE FUNCTION refuse_round_draw_seed_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Only its Round's own deletion (the cascade) removes a seed.
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM rounds WHERE id = OLD.round_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'A Round draw seed is immutable'
    USING ERRCODE = '23514', CONSTRAINT = 'round_draw_seeds_immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER round_draw_seeds_immutable BEFORE UPDATE OR DELETE ON round_draw_seeds
FOR EACH ROW EXECUTE FUNCTION refuse_round_draw_seed_change();
--> statement-breakpoint
CREATE FUNCTION guard_round_draw_erasable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR (coalesce(current_setting('daisy.privacy_erasure', true), '') <> 'on'
      AND EXISTS (SELECT 1 FROM rounds WHERE id = OLD.round_id)) THEN
    RAISE EXCEPTION 'Round draw copies change only by privacy erasure'
      USING ERRCODE = '23514', CONSTRAINT = 'round_draw_copies_erasure_only';
  END IF;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER round_resolution_draw_texts_erasure_only BEFORE UPDATE OR DELETE ON round_resolution_draw_texts
FOR EACH ROW EXECUTE FUNCTION guard_round_draw_erasable();
--> statement-breakpoint
CREATE TRIGGER round_draw_private_inputs_erasure_only BEFORE UPDATE OR DELETE ON round_draw_private_inputs
FOR EACH ROW EXECUTE FUNCTION guard_round_draw_erasable();
--> statement-breakpoint
-- A draw's strikes are fixed once made; its items change only by privacy
-- erasure scrubbing their text. Both still leave with their Room.
CREATE FUNCTION guard_room_draw_children() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'room_resolution_draw_items'
     AND coalesce(current_setting('daisy.privacy_erasure', true), '') = 'on'
     AND (NEW.draw_id, NEW.position, NEW.source_kind, NEW.draw_size, NEW.candidate_id, NEW.bank_entry_id, NEW.category)
         IS NOT DISTINCT FROM (OLD.draw_id, OLD.position, OLD.source_kind, OLD.draw_size, OLD.candidate_id, OLD.bank_entry_id, OLD.category) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'A drawn resolution or strike is fixed once made'
    USING ERRCODE = '23514', CONSTRAINT = 'room_draw_children_immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER room_resolution_strikes_immutable BEFORE UPDATE ON room_resolution_strikes
FOR EACH ROW EXECUTE FUNCTION guard_room_draw_children();
--> statement-breakpoint
CREATE TRIGGER room_resolution_draw_items_immutable BEFORE UPDATE ON room_resolution_draw_items
FOR EACH ROW EXECUTE FUNCTION guard_room_draw_children();

--> statement-breakpoint
INSERT INTO "resolution_bank_revisions" ("revision", "note") VALUES (1, 'Initial Daisy-original bank');
--> statement-breakpoint
INSERT INTO "resolution_bank_entries" ("id", "text", "category", "difficulty", "locale", "provenance", "added_in_revision") VALUES
  ('pryied8jvkvrn7g0p60iv632', 'The United States federal government should substantially increase its investment in high-speed rail.', 'policy', 'standard', 'en', 'daisy-original', 1),
  ('bua8qk562gq4bp7twjpfg935', 'Cities should abolish minimum parking requirements.', 'policy', 'standard', 'en', 'daisy-original', 1),
  ('h2n5azrcmh8rvo3jwkbzpkyn', 'National governments should adopt a universal basic income.', 'policy', 'standard', 'en', 'daisy-original', 1),
  ('tzy3u3ui9z1akajazjth5d4b', 'Public schools should adopt a four-day school week.', 'policy', 'standard', 'en', 'daisy-original', 1),
  ('irmmhw5o3l2osimimuxw0z0k', 'The voting age in national elections should be lowered to sixteen.', 'policy', 'standard', 'en', 'daisy-original', 1),
  ('l5romgfnhtdatho37qu4d66z', 'Governments should ban the sale of new gasoline-powered cars by 2035.', 'policy', 'standard', 'en', 'daisy-original', 1),
  ('t4ai8be15x010swmytxo6elz', 'Public universities should eliminate tuition for in-state students.', 'policy', 'standard', 'en', 'daisy-original', 1),
  ('dv8baq36jx1bty38cu15ph19', 'Social media platforms should be required to verify the age of their users.', 'policy', 'standard', 'en', 'daisy-original', 1),
  ('hnf368omafdq5365irfq1sxw', 'Developed nations should substantially increase foreign aid to low-income countries.', 'policy', 'standard', 'en', 'daisy-original', 1),
  ('fa7e0dokbfgc10uyfh1wspje', 'Professional sports leagues should pay college athletes a salary.', 'policy', 'standard', 'en', 'daisy-original', 1),
  ('yxmbyb6js228xqnqqskt6l59', 'Governments should break up the largest technology companies.', 'policy', 'standard', 'en', 'daisy-original', 1),
  ('sol8de7x5jq9pwelx8aya6uq', 'Cities should make public transit free to ride.', 'policy', 'standard', 'en', 'daisy-original', 1),
  ('dx7hrrg1esm8wyrneln69wqa', 'National governments should mandate a year of national service.', 'policy', 'standard', 'en', 'daisy-original', 1),
  ('h0svzsmob6hs9owmyrsu51ls', 'Schools should ban smartphones during the school day.', 'policy', 'standard', 'en', 'daisy-original', 1),
  ('b6b9yjq40xv9kmbvy4kwxahn', 'Privacy ought to be valued above public safety.', 'value', 'standard', 'en', 'daisy-original', 1),
  ('n7vdy5znavdy4wkmxgvn5lz4', 'A just society ought to prioritize equality of opportunity over equality of outcome.', 'value', 'standard', 'en', 'daisy-original', 1),
  ('dl54qk481ofx7ip4yh7tkt51', 'Individual liberty ought to be valued above the common good.', 'value', 'standard', 'en', 'daisy-original', 1),
  ('a11kfpuqa9frk5c59k4kra78', 'Civil disobedience is justified in a democracy.', 'value', 'standard', 'en', 'daisy-original', 1),
  ('ots020m6kujuszlziz61ail9', 'It is morally permissible to break a promise to prevent a lesser harm.', 'value', 'standard', 'en', 'daisy-original', 1),
  ('jti029qvujtayotuumxrqt92', 'Economic growth ought to be prioritized over environmental protection.', 'value', 'standard', 'en', 'daisy-original', 1),
  ('d8d657w6u00ikb3ldakzrk41', 'The pursuit of happiness is more important than the pursuit of truth.', 'value', 'standard', 'en', 'daisy-original', 1),
  ('jol8u6mq2tjx8txztq8nkm04', 'Loyalty to a community ought to be valued above loyalty to principle.', 'value', 'standard', 'en', 'daisy-original', 1),
  ('ud5z9aw3ra1sx81csl148bpb', 'Wealthy individuals have a moral obligation to donate much of their wealth.', 'value', 'standard', 'en', 'daisy-original', 1),
  ('fyxgc9jp1xsq12xrz5z5ygan', 'Retribution is a legitimate goal of criminal justice.', 'value', 'standard', 'en', 'daisy-original', 1),
  ('cfb12rean21lt812wm86huko', 'Free speech ought to be valued above protection from offensive speech.', 'value', 'standard', 'en', 'daisy-original', 1),
  ('q5q9ri9m99p8o4gung3h4e3f', 'Artists have a moral obligation to avoid harmful stereotypes.', 'value', 'standard', 'en', 'daisy-original', 1),
  ('tsl0c5yeh5scq5qbbhmqvtus', 'A government''s first duty is to its own citizens rather than to humanity.', 'value', 'standard', 'en', 'daisy-original', 1),
  ('olvuelzg1oiirlrwqkag90lp', 'Honesty is more important than kindness.', 'value', 'standard', 'en', 'daisy-original', 1),
  ('i7cdxk5iw39jb78scy0ewy4a', 'Social media has done more harm than good for teenagers.', 'fact', 'standard', 'en', 'daisy-original', 1),
  ('nboi8azid4z09f6nrpx7yvds', 'Remote work has made workers more productive.', 'fact', 'standard', 'en', 'daisy-original', 1),
  ('p1nt2qxiiht4o7qozzsthyqn', 'Standardized tests are a fair measure of student ability.', 'fact', 'standard', 'en', 'daisy-original', 1),
  ('j5x45or5syk8og47vwc4ksr6', 'Video games have a positive effect on young people.', 'fact', 'standard', 'en', 'daisy-original', 1),
  ('ubcc8pjr0cp3b20s713h6afq', 'Space exploration has been worth its cost.', 'fact', 'standard', 'en', 'daisy-original', 1),
  ('g3tbo5f66u4aebmlruiyuxfv', 'Globalization has done more good than harm for the developing world.', 'fact', 'standard', 'en', 'daisy-original', 1),
  ('eo673b34r7w2gp91cex1qswc', 'Artificial intelligence will create more jobs than it eliminates.', 'fact', 'standard', 'en', 'daisy-original', 1),
  ('h8q2tysmlkiu6p5uggjuexa4', 'Homework does more harm than good in elementary school.', 'fact', 'standard', 'en', 'daisy-original', 1),
  ('wniwf3f3t0vcoqsif3rti05i', 'The rise of streaming has been good for the film industry.', 'fact', 'standard', 'en', 'daisy-original', 1),
  ('u61kz5c2v3mx0fd46643b0l2', 'Nuclear power is the most practical path to a low-carbon future.', 'fact', 'standard', 'en', 'daisy-original', 1),
  ('zpbw43ua40maeqtykgvdiu58', 'Online learning is as effective as in-person learning.', 'fact', 'standard', 'en', 'daisy-original', 1),
  ('mv0nd6jqxhimdl220oj25h4p', 'Professional sports have a positive effect on their host cities.', 'fact', 'standard', 'en', 'daisy-original', 1),
  ('dstx376pzzsuy7jg5znpguls', 'Electric scooters have improved urban transportation.', 'fact', 'standard', 'en', 'daisy-original', 1),
  ('lqddhh8h4zd6etzy9ogjk6lh', 'The four-year college degree is losing its value.', 'fact', 'standard', 'en', 'daisy-original', 1);
