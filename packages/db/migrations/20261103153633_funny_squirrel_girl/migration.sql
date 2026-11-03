CREATE TABLE "media_room_rotations" (
	"id" text PRIMARY KEY,
	"round_id" text NOT NULL,
	"rotated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "broadcasts" ADD COLUMN "feed_withdrawal_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "recording_processing_jobs" ADD COLUMN "delay_alerted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "media_room_rotations_round_idx" ON "media_room_rotations" ("round_id");--> statement-breakpoint
ALTER TABLE "media_room_rotations" ADD CONSTRAINT "media_room_rotations_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;