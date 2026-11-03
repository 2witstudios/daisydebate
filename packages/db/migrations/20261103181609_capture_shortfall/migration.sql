ALTER TABLE "round_transcript_freezes" ADD COLUMN "expected_speech_ms" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "round_transcript_freezes" ADD COLUMN "capture_gap_ms" integer;--> statement-breakpoint
ALTER TABLE "round_transcript_freezes" ADD COLUMN "capture_gaps" jsonb DEFAULT '{"gaps":[]}' NOT NULL;--> statement-breakpoint
ALTER TABLE "round_transcript_freezes" ADD CONSTRAINT "round_transcript_freezes_capture_gaps_is_object" CHECK (jsonb_typeof("capture_gaps") = 'object');--> statement-breakpoint
ALTER TABLE "round_incidents" DROP CONSTRAINT "round_incidents_cause_check", ADD CONSTRAINT "round_incidents_cause_check" CHECK ("cause" in ('vendor_unreachable', 'room_retired', 'room_emptied', 'capture_below_limit'));