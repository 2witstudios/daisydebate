-- A generated column needs an immutable expression, and timestamptz + interval is
-- only declared stable, because a day or month interval depends on the time zone.
-- A whole number of milliseconds does not, so this is truly immutable.
CREATE FUNCTION round_segment_due_at(started_at timestamptz, duration_ms integer, returned_ms integer)
RETURNS timestamptz LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT started_at + (duration_ms::bigint + returned_ms) * interval '1 millisecond' $$;
--> statement-breakpoint
CREATE TABLE "round_incident_watches" (
	"round_id" text PRIMARY KEY,
	"unreachable_since" timestamp with time zone,
	"retirement_taken_up_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "round_incidents" (
	"id" text PRIMARY KEY,
	"round_id" text NOT NULL,
	"cause" text NOT NULL,
	"detected_at" timestamp with time zone NOT NULL,
	"resume_point" timestamp with time zone,
	"resumed_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"returned_ms" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "round_incidents_cause_check" CHECK ("cause" in ('vendor_unreachable', 'room_retired')),
	CONSTRAINT "round_incidents_returned_check" CHECK ("returned_ms" >= 0),
	CONSTRAINT "round_incidents_one_ending_check" CHECK ("resumed_at" is null or "ended_at" is null)
);
--> statement-breakpoint
-- Rooms already rotated are history no incident should take up.
ALTER TABLE "media_room_rotations" ADD COLUMN "cause" text NOT NULL DEFAULT 'seat-revoked';--> statement-breakpoint
ALTER TABLE "media_room_rotations" ALTER COLUMN "cause" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "media_sessions" ADD COLUMN "room_saw_capture" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "media_sessions" ADD COLUMN "room_occupied_sid" text;--> statement-breakpoint
ALTER TABLE "round_segments" ADD COLUMN "returned_ms" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "round_segments" ADD COLUMN "due_at" timestamp with time zone GENERATED ALWAYS AS (round_segment_due_at("round_segments"."started_at", "round_segments"."duration_ms", "round_segments"."returned_ms")) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "round_transcript_freezes" ADD COLUMN "expected_speech_ms" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "round_transcript_freezes" ADD COLUMN "capture_gap_ms" integer;--> statement-breakpoint
ALTER TABLE "round_transcript_freezes" ADD COLUMN "unheard_ms" integer;--> statement-breakpoint
ALTER TABLE "round_transcript_freezes" ADD COLUMN "capture_gaps" jsonb DEFAULT '{"gaps":[]}' NOT NULL;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "platform_ending" text;--> statement-breakpoint
ALTER TABLE "rounds" ALTER COLUMN "runtime_state" SET DEFAULT '{"version":1,"prep_consumed_ms":{"affirmative":0,"negative":0},"active_prep":null,"floor":null,"incident":{"phase":"none"},"clock_stops":[]}';--> statement-breakpoint
CREATE UNIQUE INDEX "round_incidents_single_open" ON "round_incidents" ("round_id") WHERE "resumed_at" is null and "ended_at" is null;--> statement-breakpoint
CREATE INDEX "round_incidents_round_idx" ON "round_incidents" ("round_id");--> statement-breakpoint
CREATE INDEX "round_incidents_detected_idx" ON "round_incidents" ("detected_at");--> statement-breakpoint
ALTER TABLE "round_incident_watches" ADD CONSTRAINT "round_incident_watches_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "round_incidents" ADD CONSTRAINT "round_incidents_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "round_segments" ADD CONSTRAINT "round_segments_returned_check" CHECK ("returned_ms" >= 0);--> statement-breakpoint
ALTER TABLE "round_transcript_freezes" ADD CONSTRAINT "round_transcript_freezes_capture_gaps_is_object" CHECK (jsonb_typeof("capture_gaps") = 'object');--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_platform_ending_check" CHECK ("platform_ending" is null or ("platform_ending" = 'recovery_bound' and "status" = 'abandoned') or ("platform_ending" = 'capture_shortfall' and "status" in ('active', 'completed')));--> statement-breakpoint
-- The checkpoint schema is strict, so every stored checkpoint gains the new fields.
-- A merge of two objects with constant keys cannot refuse.
UPDATE "rounds" SET "runtime_state" = '{"incident":{"phase":"none"},"clock_stops":[]}'::jsonb || "runtime_state" WHERE NOT ("runtime_state" ? 'incident');
