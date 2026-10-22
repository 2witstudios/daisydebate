CREATE TABLE "round_speaking_intervals" (
	"id" text PRIMARY KEY,
	"round_id" text NOT NULL,
	"segment_id" text NOT NULL,
	"round_participant_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"started_version" integer NOT NULL,
	"ended_version" integer,
	"started_command_id" text,
	"ended_command_id" text,
	CONSTRAINT "round_speaking_intervals_time_check" CHECK ("ended_at" is null or "ended_at" > "started_at"),
	CONSTRAINT "round_speaking_intervals_version_check" CHECK ("started_version" > 0 and ("ended_version" is null or "ended_version" >= "started_version")),
	CONSTRAINT "round_speaking_intervals_close_pair" CHECK (("ended_at" is null) = ("ended_version" is null)),
	CONSTRAINT "round_speaking_intervals_ended_command_check" CHECK ("ended_command_id" is null or "ended_at" is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "round_commands_id_round_unique" ON "round_commands" ("command_id","round_id");--> statement-breakpoint
CREATE INDEX "round_speaking_intervals_segment_round_idx" ON "round_speaking_intervals" ("segment_id","round_id");--> statement-breakpoint
CREATE INDEX "round_speaking_intervals_participant_round_idx" ON "round_speaking_intervals" ("round_participant_id","round_id");--> statement-breakpoint
CREATE INDEX "round_speaking_intervals_history_idx" ON "round_speaking_intervals" ("round_id","segment_id","round_participant_id","started_at");--> statement-breakpoint
CREATE INDEX "round_speaking_intervals_started_command_idx" ON "round_speaking_intervals" ("started_command_id","round_id");--> statement-breakpoint
CREATE INDEX "round_speaking_intervals_ended_command_idx" ON "round_speaking_intervals" ("ended_command_id","round_id");--> statement-breakpoint
ALTER TABLE "round_speaking_intervals" ADD CONSTRAINT "round_speaking_intervals_segment_round_fk" FOREIGN KEY ("segment_id","round_id") REFERENCES "round_segments"("id","round_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "round_speaking_intervals" ADD CONSTRAINT "round_speaking_intervals_participant_round_fk" FOREIGN KEY ("round_participant_id","round_id") REFERENCES "round_participants"("id","round_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "round_speaking_intervals" ADD CONSTRAINT "round_speaking_intervals_started_command_round_fk" FOREIGN KEY ("started_command_id","round_id") REFERENCES "round_commands"("command_id","round_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "round_speaking_intervals" ADD CONSTRAINT "round_speaking_intervals_ended_command_round_fk" FOREIGN KEY ("ended_command_id","round_id") REFERENCES "round_commands"("command_id","round_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "round_commands" DROP CONSTRAINT "round_commands_type_check", ADD CONSTRAINT "round_commands_type_check" CHECK ("type" in ('start', 'start_prep', 'end_prep', 'start_speech', 'yield', 'interrupt', 'forfeit', 'complete'));
--> statement-breakpoint
-- Drizzle 1.0.0-rc.4 cannot represent exclusion constraints. PostgreSQL's
-- trusted bundled btree_gist supplies text equality beside tstzrange overlap.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE round_speaking_intervals ADD CONSTRAINT round_speaking_intervals_no_overlap
EXCLUDE USING gist (
  segment_id WITH =,
  round_participant_id WITH =,
  tstzrange(started_at, ended_at, '[)') WITH &&
);
