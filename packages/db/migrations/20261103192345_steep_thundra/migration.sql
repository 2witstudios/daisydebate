ALTER TABLE "broadcasts" ADD COLUMN "release_not_before" timestamp with time zone;--> statement-breakpoint
-- Each worker's role by column: new columns are denied until named, and the hold worker
-- can never read a stage credential's hash (ADR 0099).
REVOKE SELECT, UPDATE ON "broadcasts" FROM daisy_broadcast_worker;--> statement-breakpoint
GRANT SELECT (id, round_id, delivery_path, release_policy, debaters_read_chat, chat_slow_mode_seconds, egress_id, egress_started_at, observer_revoked_at, revocation_failures, next_segment, egress_generation, release_skips, released_generation, hold_cursor, stream_ended_at, released_through_at, final_media_end_at, stopped_at, stop_reason, media_withheld, completed_at, feed_withdrawal_requested_at, feed_withdrawn_at, reconcile_lease_until, control_heartbeat_at, release_not_before, lease_epoch, lease_owner, lease_until, created_at, feed_key) ON "broadcasts" TO daisy_broadcast_worker;--> statement-breakpoint
GRANT UPDATE (next_segment, release_skips, released_generation, hold_cursor, stream_ended_at, released_through_at, completed_at, feed_withdrawn_at, release_not_before, lease_epoch, lease_owner, lease_until) ON "broadcasts" TO daisy_broadcast_worker;--> statement-breakpoint
REVOKE SELECT, UPDATE ON "recording_processing_jobs" FROM daisy_recording_worker;--> statement-breakpoint
GRANT SELECT (recording_id, hold_prefix, status, state, runs_started, due_at, lease_owner, lease_until, delay_alerted_at, lease_epoch, created_at, updated_at) ON "recording_processing_jobs" TO daisy_recording_worker;--> statement-breakpoint
GRANT UPDATE (status, state, runs_started, due_at, lease_owner, lease_until, lease_epoch, updated_at) ON "recording_processing_jobs" TO daisy_recording_worker;
