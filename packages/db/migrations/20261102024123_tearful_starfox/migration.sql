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
        or ("evidence" = 'infrastructure_unresolved' and "decision" = 'abandoned' and "effective_deadline" is null and "settled_horizon" is null and "receipt_participant_id" is null));