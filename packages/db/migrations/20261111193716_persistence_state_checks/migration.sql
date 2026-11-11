-- State machine audit, slice 4: persistence machines. Each CHECK states a
-- pairing the lifecycle's writers already keep. NOT VALID adds it without
-- reading stored rows, so it cannot refuse a deploy and takes its lock only
-- briefly; every later write is checked from here on. The next folder
-- validates them against what is stored.
ALTER TABLE "notification_emails" ALTER COLUMN "state" SET DEFAULT 'queued';--> statement-breakpoint
ALTER TABLE "notification_emails" ALTER COLUMN "attempts" SET DEFAULT 0;--> statement-breakpoint
-- Two stored states have exactly one right repair, so they are repaired here and
-- their CHECKs always validate. A failure counted after its revocation landed
-- means nothing; a removal with no due time is due now, and a due time on a
-- Recording that is not being removed is left over.
UPDATE "broadcasts" SET "revocation_failures" = 0 WHERE "observer_revoked_at" IS NOT NULL AND "revocation_failures" <> 0;--> statement-breakpoint
UPDATE "recordings" SET "deletion_due_at" = CASE WHEN "status" = 'removing' THEN clock_timestamp() END WHERE ("status" = 'removing') <> ("deletion_due_at" IS NOT NULL);--> statement-breakpoint
SET CONSTRAINTS ALL IMMEDIATE;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_stop_reason_check" CHECK ("stop_reason" is null or "stop_reason" in ('policy_violation', 'legal_request', 'participant_safety', 'technical', 'recording_removed', 'recording_legally_removed', 'recording_removed_by_participant', 'recording_removed_by_erasure')) NOT VALID;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_completed_check" CHECK ("completed_at" is null or "stream_ended_at" is not null or "stopped_at" is not null) NOT VALID;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_feed_withdrawn_check" CHECK ("feed_withdrawn_at" is null or "completed_at" is not null or "stopped_at" is not null) NOT VALID;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_feed_withdrawal_requested_check" CHECK ("feed_withdrawal_requested_at" is null or "completed_at" is not null) NOT VALID;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_observer_revoked_check" CHECK ("observer_revoked_at" is null or "revocation_failures" = 0) NOT VALID;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_egress_check" CHECK ("egress_id" is null or "egress_started_at" is not null) NOT VALID;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_ends_after_start_check" CHECK ("ends_at" is null or "ends_at" > "starts_at") NOT VALID;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_lifted_after_start_check" CHECK ("lifted_at" is null or "lifted_at" >= "starts_at") NOT VALID;--> statement-breakpoint
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_deletion_due_check" CHECK (("status" = 'removing') = ("deletion_due_at" is not null)) NOT VALID;