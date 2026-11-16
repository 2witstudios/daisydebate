-- ADR 0142: Freestyle is Daisy's one standard and one ladder. Policy and
-- Value, their presets, published resolutions and rating ladders are
-- deleted outright; the owner waived keeping any of their rows (pre-release,
-- 2026-11-16). Every Round on either format, and every Room whose format is
-- either (with all of that Room's Rounds), goes with them.
CREATE TEMP TABLE deleted_rooms ON COMMIT DROP AS
  SELECT id FROM public.rooms WHERE format_id IN ('policy','value');--> statement-breakpoint
CREATE TEMP TABLE deleted_rounds ON COMMIT DROP AS
  SELECT id FROM public.rounds
  WHERE format_id IN ('policy','value')
     OR ladder_id IN ('policy','value')
     OR room_id IN (SELECT id FROM deleted_rooms);--> statement-breakpoint
-- Recorded media leaves storage only through the deletion sweep, which finds
-- it from its recordings row. Dropping a row whose media remains would orphan
-- it, so the operator removes these recordings first (docs/operations/
-- database.md, ADR 0142) and this refuses until every one is removed and
-- every capture has ended. A removed recording holds no objects or sources.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.recordings
     WHERE round_id IN (SELECT id FROM deleted_rounds) AND status <> 'removed'
  ) OR EXISTS (
    SELECT 1 FROM public.recording_captures
     WHERE round_id IN (SELECT id FROM deleted_rounds) AND ended_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Freestyle only (ADR 0142) requires every Policy and Value recording removed first: see docs/operations/database.md';
  END IF;
END
$$;--> statement-breakpoint
DELETE FROM public.rating_changes
  WHERE ladder IN ('policy','value')
     OR format_id IN ('policy','value')
     OR round_id IN (SELECT id FROM deleted_rounds);--> statement-breakpoint
DELETE FROM public.ratings WHERE ladder IN ('policy','value');--> statement-breakpoint
DELETE FROM public.recording_processing_jobs
  WHERE recording_id IN (
    SELECT id FROM public.recordings WHERE round_id IN (SELECT id FROM deleted_rounds)
  );--> statement-breakpoint
DELETE FROM public.recording_captures
  WHERE round_id IN (SELECT id FROM deleted_rounds)
     OR recording_id IN (
       SELECT id FROM public.recordings WHERE round_id IN (SELECT id FROM deleted_rounds)
     );--> statement-breakpoint
DELETE FROM public.recordings WHERE round_id IN (SELECT id FROM deleted_rounds);--> statement-breakpoint
DELETE FROM public.rounds WHERE id IN (SELECT id FROM deleted_rounds);--> statement-breakpoint
DELETE FROM public.rooms WHERE id IN (SELECT id FROM deleted_rooms);--> statement-breakpoint
-- A surviving Custom Room that started from Policy or Value keeps its own
-- rules; only its pointer to the deleted basis goes.
UPDATE public.rooms SET basis_format_id = NULL, basis_preset_version = NULL
  WHERE basis_format_id IN ('policy','value');--> statement-breakpoint
DELETE FROM public.challenges WHERE format_id IN ('policy','value');--> statement-breakpoint
DELETE FROM public.format_presets WHERE format_id IN ('policy','value');--> statement-breakpoint
DELETE FROM public.formats WHERE id IN ('policy','value');--> statement-breakpoint
DELETE FROM public.format_revisions WHERE format_id IN ('policy','value');--> statement-breakpoint
SET CONSTRAINTS ALL IMMEDIATE;--> statement-breakpoint
DROP FUNCTION public.daisy_current_published_resolution(text,text);--> statement-breakpoint
ALTER TABLE "rooms" DROP CONSTRAINT "rooms_published_resolution_id_published_resolutions_id_fkey";--> statement-breakpoint
ALTER TABLE "rounds" DROP CONSTRAINT "rounds_published_resolution_id_published_resolutions_id_fkey";--> statement-breakpoint
DROP TABLE "published_resolutions";--> statement-breakpoint
DROP TABLE "rating_visibility";--> statement-breakpoint
DROP INDEX "rooms_published_resolution_idx";--> statement-breakpoint
DROP INDEX "rounds_published_resolution_idx";--> statement-breakpoint
ALTER TABLE "rooms" DROP COLUMN "published_resolution_id";--> statement-breakpoint
ALTER TABLE "rounds" DROP COLUMN "published_resolution_id";--> statement-breakpoint
ALTER TABLE "challenges" DROP CONSTRAINT "challenges_format_check", ADD CONSTRAINT "challenges_format_check" CHECK ("format_id" in ('freestyle'));--> statement-breakpoint
ALTER TABLE "formats" DROP CONSTRAINT "formats_standard_ids", ADD CONSTRAINT "formats_standard_ids" CHECK ("catalog_role" is distinct from 'standard' or "id" in ('freestyle'));--> statement-breakpoint
ALTER TABLE "rating_changes" DROP CONSTRAINT "rating_changes_ladder_check", ADD CONSTRAINT "rating_changes_ladder_check" CHECK ("ladder" in ('freestyle'));--> statement-breakpoint
ALTER TABLE "ratings" DROP CONSTRAINT "ratings_ladder_check", ADD CONSTRAINT "ratings_ladder_check" CHECK ("ladder" in ('freestyle'));--> statement-breakpoint
ALTER TABLE "rounds" DROP CONSTRAINT "rounds_ladder_check", ADD CONSTRAINT "rounds_ladder_check" CHECK ("ladder_id" is null or "ladder_id" in ('freestyle'));--> statement-breakpoint
DROP FUNCTION public.daisy_preserve_published_resolution();
