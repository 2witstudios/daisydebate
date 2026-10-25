--> Every Round is full length (DEC-237). No product path ever wrote quick
--> rows, but a dev or restore database may hold some, so they are handled
--> before the length columns go. Rules snapshots are never touched, so a
--> pinned Round stays readable.
--> The Quick ladder has no producer left: its ratings and ledger rows go
--> with it (DEC-240).
DELETE FROM "rating_changes" WHERE "ladder" = 'quick';--> statement-breakpoint
DELETE FROM "ratings" WHERE "ladder" = 'quick';--> statement-breakpoint
--> Open quick Rooms and Rounds are closed.
UPDATE "rooms" SET "status" = 'abandoned', "updated_at" = statement_timestamp() WHERE "length" = 'quick' AND "status" IN ('assembling', 'ready');--> statement-breakpoint
UPDATE "rounds" SET "status" = 'abandoned', "current_stage" = NULL, "outcome" = NULL, "completed_at" = statement_timestamp(), "updated_at" = statement_timestamp() WHERE "length" = 'quick' AND "status" IN ('scheduled', 'active');--> statement-breakpoint
--> A quick ranked Room or Round becomes casual: its preset and ladder retire with quick.
UPDATE "rooms" SET "competition_type" = 'casual', "preset_version" = NULL WHERE "length" = 'quick' AND "competition_type" = 'ranked';--> statement-breakpoint
UPDATE "rounds" SET "competition_type" = 'casual', "preset_version" = NULL, "ladder_id" = NULL WHERE "length" = 'quick' AND "competition_type" = 'ranked';--> statement-breakpoint
DELETE FROM "format_presets" WHERE "length" = 'quick';--> statement-breakpoint
--> The provenance keys lose length: drop what depends on it, then the columns.
ALTER TABLE "rooms" DROP CONSTRAINT "rooms_preset_provenance_fk";--> statement-breakpoint
ALTER TABLE "rounds" DROP CONSTRAINT "rounds_preset_provenance_fk";--> statement-breakpoint
DROP INDEX "rooms_preset_version_idx";--> statement-breakpoint
DROP INDEX "rounds_preset_provenance_idx";--> statement-breakpoint
DROP INDEX "format_presets_provenance_unique";--> statement-breakpoint
DROP INDEX "format_presets_single_current";--> statement-breakpoint
ALTER TABLE "format_presets" DROP CONSTRAINT "format_presets_pkey";--> statement-breakpoint
ALTER TABLE "rounds" DROP CONSTRAINT "rounds_ladder_derivation_check";--> statement-breakpoint
ALTER TABLE "format_presets" DROP CONSTRAINT "format_presets_length_check";--> statement-breakpoint
ALTER TABLE "member_onboarding" DROP CONSTRAINT "member_onboarding_length_check";--> statement-breakpoint
ALTER TABLE "rooms" DROP CONSTRAINT "rooms_length_check";--> statement-breakpoint
ALTER TABLE "rounds" DROP CONSTRAINT "rounds_length_check";--> statement-breakpoint
ALTER TABLE "format_presets" DROP COLUMN "length";--> statement-breakpoint
ALTER TABLE "member_onboarding" DROP COLUMN "length";--> statement-breakpoint
ALTER TABLE "rooms" DROP COLUMN "length";--> statement-breakpoint
ALTER TABLE "rounds" DROP COLUMN "length";--> statement-breakpoint
ALTER TABLE "format_presets" ADD PRIMARY KEY ("format_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "format_presets_provenance_unique" ON "format_presets" ("format_id","version","format_version");--> statement-breakpoint
CREATE UNIQUE INDEX "format_presets_single_current" ON "format_presets" ("format_id") WHERE "superseded_at" is null;--> statement-breakpoint
CREATE INDEX "rooms_preset_version_idx" ON "rooms" ("format_id","preset_version","format_version");--> statement-breakpoint
CREATE INDEX "rounds_preset_provenance_idx" ON "rounds" ("format_id","preset_version","format_version");--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_preset_provenance_fk" FOREIGN KEY ("format_id","preset_version","format_version") REFERENCES "format_presets"("format_id","version","format_version");--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_preset_provenance_fk" FOREIGN KEY ("format_id","preset_version","format_version") REFERENCES "format_presets"("format_id","version","format_version");--> statement-breakpoint
--> One ladder remains (DEC-238).
ALTER TABLE "rating_changes" DROP CONSTRAINT "rating_changes_ladder_check", ADD CONSTRAINT "rating_changes_ladder_check" CHECK ("ladder" in ('ranked'));--> statement-breakpoint
ALTER TABLE "ratings" DROP CONSTRAINT "ratings_ladder_check", ADD CONSTRAINT "ratings_ladder_check" CHECK ("ladder" in ('ranked'));--> statement-breakpoint
ALTER TABLE "rounds" DROP CONSTRAINT "rounds_ladder_check", ADD CONSTRAINT "rounds_ladder_check" CHECK ("ladder_id" is null or "ladder_id" in ('ranked'));
