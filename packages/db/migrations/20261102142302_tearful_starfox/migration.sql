ALTER TABLE "round_attendance_adjudications" ADD COLUMN "evidence" text DEFAULT 'settled_availability' NOT NULL;--> statement-breakpoint
ALTER TABLE "round_attendance_adjudications" ADD COLUMN "receipt_participant_id" text;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "attendance_resolution_cutoff_at" timestamp with time zone;--> statement-breakpoint
UPDATE "rounds" SET "attendance_resolution_cutoff_at" = "final_segment_ended_at" + interval '60 minutes' WHERE "final_segment_ended_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "round_attendance_adjudications" ALTER COLUMN "effective_deadline" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "round_attendance_adjudications" ALTER COLUMN "settled_horizon" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "round_attendance_adjudications_receipt_idx" ON "round_attendance_adjudications" ("round_id","segment_id","receipt_participant_id");--> statement-breakpoint
ALTER TABLE "round_attendance_adjudications" ADD CONSTRAINT "round_attendance_adjudications_receipt_fk" FOREIGN KEY ("round_id","segment_id","receipt_participant_id") REFERENCES "round_check_ins"("round_id","segment_id","participant_id");--> statement-breakpoint
ALTER TABLE "round_attendance_adjudications" ADD CONSTRAINT "round_attendance_adjudications_evidence_check" CHECK (("evidence" = 'settled_availability' and "effective_deadline" is not null and "settled_horizon" is not null and "receipt_participant_id" is null)
        or ("evidence" = 'on_time_receipt' and "decision" = 'attended' and "effective_deadline" is null and "settled_horizon" is null and "receipt_participant_id" is not null)
        or ("evidence" = 'infrastructure_unresolved' and "decision" = 'abandoned' and "effective_deadline" is null and "settled_horizon" is null and "receipt_participant_id" is null));--> statement-breakpoint
-- A judged Round completes without a winner only once no human judge can still
-- rule: the deadline fence is for the human window, which an AI-only panel does
-- not have (DEC-275, DEC-277). The AI seat's own bound lives on its job.
CREATE OR REPLACE FUNCTION guard_unjudged_round_participants() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_round text;
BEGIN
  IF TG_TABLE_NAME = 'rounds' THEN
    target_round := NEW.id;
  ELSE
    target_round := NEW.round_id;
  END IF;
  PERFORM id FROM rounds WHERE id = target_round FOR NO KEY UPDATE;
  IF EXISTS (
    SELECT 1 FROM rounds r
    WHERE r.id = target_round AND r.status = 'completed' AND r.outcome IS NULL
      AND EXISTS (
        SELECT 1 FROM round_participants p JOIN actors a ON a.id = p.actor_id
        WHERE p.round_id = r.id AND p.role = 'judge' AND a.kind = 'human'
      )
      AND (r.ballot_deadline_at IS NULL OR clock_timestamp() < r.ballot_deadline_at)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'rounds_unjudged_participants_check', MESSAGE = 'A Round with a human judge completes without a winner only at its ballot deadline';
  END IF;
  RETURN NEW;
END;
$$;
