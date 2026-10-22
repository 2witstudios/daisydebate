CREATE TABLE "media_participants" (
	"id" text PRIMARY KEY,
	"session_id" text NOT NULL,
	"round_id" text NOT NULL,
	"round_participant_id" text NOT NULL,
	"identity" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_sessions" (
	"id" text PRIMARY KEY,
	"round_id" text NOT NULL,
	"room_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "media_sessions_end_check" CHECK ("ended_at" is null or "ended_at" >= "created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "media_participants_seat_unique" ON "media_participants" ("session_id","round_participant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_participants_identity_unique" ON "media_participants" ("identity");--> statement-breakpoint
CREATE INDEX "media_participants_session_round_idx" ON "media_participants" ("session_id","round_id");--> statement-breakpoint
CREATE INDEX "media_participants_participant_round_idx" ON "media_participants" ("round_participant_id","round_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_sessions_round_unique" ON "media_sessions" ("round_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_sessions_room_unique" ON "media_sessions" ("room_name");--> statement-breakpoint
CREATE UNIQUE INDEX "media_sessions_id_round_unique" ON "media_sessions" ("id","round_id");--> statement-breakpoint
ALTER TABLE "media_participants" ADD CONSTRAINT "media_participants_session_round_fk" FOREIGN KEY ("session_id","round_id") REFERENCES "media_sessions"("id","round_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "media_participants" ADD CONSTRAINT "media_participants_participant_round_fk" FOREIGN KEY ("round_participant_id","round_id") REFERENCES "round_participants"("id","round_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "media_sessions" ADD CONSTRAINT "media_sessions_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;