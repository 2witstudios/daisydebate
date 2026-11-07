ALTER TABLE "round_judging_jobs" ADD COLUMN "recovery_reason" text;--> statement-breakpoint
ALTER TABLE "round_judging_jobs" ADD CONSTRAINT "round_judging_jobs_recovery_check" CHECK (("status" in ('recovering','blocked')) = ("recovery_reason" is not null)
        and ("recovery_reason" is null or "recovery_reason" in ('attempt_window', 'provider_refused', 'automatic_spend'))
        and ("status" <> 'recovering' or "retry_at" is not null));--> statement-breakpoint
ALTER TABLE "round_judging_jobs" DROP CONSTRAINT "round_judging_jobs_status_check", ADD CONSTRAINT "round_judging_jobs_status_check" CHECK ("status" in ('queued', 'leased', 'recovering', 'blocked', 'succeeded', 'failed'));