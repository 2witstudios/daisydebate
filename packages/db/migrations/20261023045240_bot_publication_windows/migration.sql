CREATE TABLE "round_bot_publication_windows" (
	"id" text PRIMARY KEY,
	"round_id" text NOT NULL,
	"segment_id" text NOT NULL,
	"round_participant_id" text NOT NULL,
	"credited_from" timestamp with time zone NOT NULL,
	"credited_until" timestamp with time zone NOT NULL,
	CONSTRAINT "round_bot_publication_windows_range_check" CHECK ("credited_until" > "credited_from")
);
--> statement-breakpoint
CREATE INDEX "round_bot_publication_windows_stream_idx" ON "round_bot_publication_windows" ("segment_id","round_id","round_participant_id","credited_until");--> statement-breakpoint
CREATE INDEX "round_bot_publication_windows_seat_round_idx" ON "round_bot_publication_windows" ("round_participant_id","round_id");--> statement-breakpoint
ALTER TABLE "round_bot_publication_windows" ADD CONSTRAINT "round_bot_publication_windows_seat_round_fk" FOREIGN KEY ("round_participant_id","round_id") REFERENCES "round_participants"("id","round_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "round_bot_publication_windows" ADD CONSTRAINT "round_bot_publication_windows_segment_round_fk" FOREIGN KEY ("segment_id","round_id") REFERENCES "round_segments"("id","round_id") ON DELETE CASCADE;