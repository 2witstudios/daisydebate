ALTER TABLE "rounds" ADD COLUMN "final_segment_ended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "transcript_admission_cutoff" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_transcript_cutoff_check" CHECK (("final_segment_ended_at" is null and "transcript_admission_cutoff" is null) or ("final_segment_ended_at" is not null and "transcript_admission_cutoff" is not null and "transcript_admission_cutoff" = "final_segment_ended_at" + interval '120 seconds'));
--> statement-breakpoint
CREATE FUNCTION preserve_round_final_segment_end() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.final_segment_ended_at IS NOT NULL AND
     (NEW.final_segment_ended_at IS DISTINCT FROM OLD.final_segment_ended_at OR
      NEW.transcript_admission_cutoff IS DISTINCT FROM OLD.transcript_admission_cutoff) THEN
    RAISE EXCEPTION 'The final segment end and transcript cutoff are immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'rounds_final_segment_end_immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER rounds_final_segment_end_immutable BEFORE UPDATE ON rounds
FOR EACH ROW EXECUTE FUNCTION preserve_round_final_segment_end();
