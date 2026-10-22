CREATE TABLE "media_worker_leases" (
	"session_id" text PRIMARY KEY,
	"worker_id" text NOT NULL,
	"epoch" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "media_worker_leases_epoch_check" CHECK ("epoch" > 0)
);
--> statement-breakpoint
CREATE TABLE "round_transcripts" (
	"round_id" text PRIMARY KEY,
	"revision" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "round_transcripts_revision_check" CHECK ("revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "transcript_observations" (
	"id" text PRIMARY KEY,
	"round_id" text NOT NULL,
	"segment_id" text NOT NULL,
	"round_participant_id" text NOT NULL,
	"track_id" text NOT NULL,
	"worker_epoch" integer NOT NULL,
	"observed_from" timestamp with time zone NOT NULL,
	"observed_until" timestamp with time zone NOT NULL,
	CONSTRAINT "transcript_observations_range_check" CHECK ("observed_until" > "observed_from"),
	CONSTRAINT "transcript_observations_epoch_check" CHECK ("worker_epoch" > 0),
	CONSTRAINT "transcript_observations_track_check" CHECK (char_length("track_id") between 1 and 128)
);
--> statement-breakpoint
CREATE TABLE "transcript_segments" (
	"round_id" text NOT NULL,
	"segment_id" text,
	"round_participant_id" text,
	"state" text DEFAULT 'open' NOT NULL,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"sealed_chunk_count" integer,
	"sealed_at" timestamp with time zone,
	CONSTRAINT "transcript_segments_pkey" PRIMARY KEY("segment_id","round_participant_id"),
	CONSTRAINT "transcript_segments_state_check" CHECK ("state" in ('open', 'complete', 'partial')),
	CONSTRAINT "transcript_segments_counts_check" CHECK ("chunk_count" >= 0 and ("sealed_chunk_count" is null or "sealed_chunk_count" >= 0)),
	CONSTRAINT "transcript_segments_seal_check" CHECK (("state" = 'open' and "sealed_at" is null and "sealed_chunk_count" is null) or ("state" <> 'open' and "sealed_at" is not null and "sealed_chunk_count" is not null)),
	CONSTRAINT "transcript_segments_complete_count_check" CHECK ("state" <> 'complete' or "chunk_count" = "sealed_chunk_count")
);
--> statement-breakpoint
ALTER TABLE "utterances" ADD COLUMN "clip_key" text;--> statement-breakpoint
ALTER TABLE "utterances" ADD COLUMN "capture_track_id" text;--> statement-breakpoint
ALTER TABLE "utterances" ADD COLUMN "capture_start_offset_ms" integer;--> statement-breakpoint
ALTER TABLE "utterances" ADD COLUMN "capture_duration_ms" integer;--> statement-breakpoint
ALTER TABLE "utterances" ADD COLUMN "capture_worker_epoch" integer;--> statement-breakpoint
ALTER TABLE "utterances" ADD COLUMN "capture_body_digest" text;--> statement-breakpoint
CREATE INDEX "transcript_observations_stream_round_idx" ON "transcript_observations" ("segment_id","round_participant_id","round_id","observed_from");--> statement-breakpoint
CREATE UNIQUE INDEX "transcript_segments_stream_round_unique" ON "transcript_segments" ("segment_id","round_participant_id","round_id");--> statement-breakpoint
CREATE INDEX "transcript_segments_segment_round_idx" ON "transcript_segments" ("segment_id","round_id");--> statement-breakpoint
CREATE INDEX "transcript_segments_participant_round_idx" ON "transcript_segments" ("round_participant_id","round_id");--> statement-breakpoint
CREATE INDEX "transcript_segments_round_idx" ON "transcript_segments" ("round_id");--> statement-breakpoint
CREATE UNIQUE INDEX "utterances_capture_clip_unique" ON "utterances" ("clip_key");--> statement-breakpoint
CREATE UNIQUE INDEX "utterances_capture_position_unique" ON "utterances" ("segment_id","round_participant_id","capture_track_id","capture_start_offset_ms");--> statement-breakpoint
ALTER TABLE "media_worker_leases" ADD CONSTRAINT "media_worker_leases_session_id_media_sessions_id_fkey" FOREIGN KEY ("session_id") REFERENCES "media_sessions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "round_transcripts" ADD CONSTRAINT "round_transcripts_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "transcript_observations" ADD CONSTRAINT "transcript_observations_stream_round_fk" FOREIGN KEY ("segment_id","round_participant_id","round_id") REFERENCES "transcript_segments"("segment_id","round_participant_id","round_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD CONSTRAINT "transcript_segments_segment_round_fk" FOREIGN KEY ("segment_id","round_id") REFERENCES "round_segments"("id","round_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD CONSTRAINT "transcript_segments_participant_round_fk" FOREIGN KEY ("round_participant_id","round_id") REFERENCES "round_participants"("id","round_id");--> statement-breakpoint
ALTER TABLE "utterances" ADD CONSTRAINT "utterances_capture_pair_check" CHECK (("clip_key" is null and "capture_track_id" is null and "capture_start_offset_ms" is null and "capture_duration_ms" is null and "capture_worker_epoch" is null and "capture_body_digest" is null) or ("clip_key" is not null and "capture_track_id" is not null and "capture_start_offset_ms" is not null and "capture_duration_ms" is not null and "capture_worker_epoch" is not null and "capture_body_digest" is not null));--> statement-breakpoint
ALTER TABLE "utterances" ADD CONSTRAINT "utterances_capture_metadata_check" CHECK ("clip_key" is null or ("clip_key" ~ '^[0-9a-f]{64}$' and "capture_body_digest" ~ '^[0-9a-f]{64}$' and char_length("capture_track_id") between 1 and 128 and "capture_start_offset_ms" >= 0 and "capture_duration_ms" > 0 and "capture_duration_ms" <= 60000 and "capture_worker_epoch" > 0));
--> statement-breakpoint
ALTER TABLE transcript_segments ALTER CONSTRAINT transcript_segments_participant_round_fk DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE FUNCTION preserve_transcript_segment_seal() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state <> 'open' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'A transcript stream seal is immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'transcript_segments_seal_immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER transcript_segments_seal_immutable BEFORE UPDATE ON transcript_segments
FOR EACH ROW EXECUTE FUNCTION preserve_transcript_segment_seal();
