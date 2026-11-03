CREATE TABLE "recording_pov_captures" (
	"recording_id" text,
	"round_id" text NOT NULL,
	"round_participant_id" text,
	"camera" boolean NOT NULL,
	"egress_room" text,
	"egress_id" text,
	"egress_started_at" timestamp with time zone,
	"egress_generation" integer DEFAULT 0 NOT NULL,
	"observer_revoked_at" timestamp with time zone,
	"revocation_failures" integer DEFAULT 0 NOT NULL,
	"camera_height" integer,
	"reconcile_lease_until" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recording_pov_captures_pkey" PRIMARY KEY("recording_id","round_participant_id"),
	CONSTRAINT "recording_pov_captures_counters_check" CHECK ("egress_generation" >= 0 and "revocation_failures" >= 0 and ("camera_height" is null or "camera_height" > 0))
);
--> statement-breakpoint
CREATE INDEX "recording_pov_captures_round_idx" ON "recording_pov_captures" ("round_id");--> statement-breakpoint
CREATE INDEX "recording_pov_captures_open_idx" ON "recording_pov_captures" ("recording_id") WHERE "ended_at" is null;--> statement-breakpoint
ALTER TABLE "recording_pov_captures" ADD CONSTRAINT "recording_pov_captures_recording_id_recordings_id_fkey" FOREIGN KEY ("recording_id") REFERENCES "recordings"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "recording_pov_captures" ADD CONSTRAINT "recording_pov_captures_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "recording_pov_captures" ADD CONSTRAINT "recording_pov_captures_participant_round_fk" FOREIGN KEY ("round_participant_id","round_id") REFERENCES "round_participants"("id","round_id");