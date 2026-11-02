ALTER TABLE "round_attendance_adjudications" ALTER COLUMN "evidence" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "round_attendance_adjudications" DROP CONSTRAINT "round_attendance_adjudications_evidence_check";--> statement-breakpoint
-- One name for the ending (ISSUE-988). The row is immutable to the app; only this rename may touch it, before the new constraint.
ALTER TABLE "round_attendance_adjudications" DISABLE TRIGGER "round_attendance_adjudications_immutable";--> statement-breakpoint
UPDATE "round_attendance_adjudications" SET "evidence" = 'resolution_cutoff' WHERE "evidence" = 'infrastructure_unresolved';--> statement-breakpoint
SET CONSTRAINTS ALL IMMEDIATE;--> statement-breakpoint
ALTER TABLE "round_attendance_adjudications" ENABLE TRIGGER "round_attendance_adjudications_immutable";--> statement-breakpoint
ALTER TABLE "round_attendance_adjudications" ADD CONSTRAINT "round_attendance_adjudications_evidence_check" CHECK (("evidence" = 'settled_availability' and "effective_deadline" is not null and "settled_horizon" is not null and "receipt_participant_id" is null)
        or ("evidence" = 'on_time_receipt' and "decision" = 'attended' and "effective_deadline" is null and "settled_horizon" is null and "receipt_participant_id" is not null)
        or ("evidence" = 'resolution_cutoff' and "decision" = 'abandoned' and "effective_deadline" is null and "settled_horizon" is null and "receipt_participant_id" is null));
