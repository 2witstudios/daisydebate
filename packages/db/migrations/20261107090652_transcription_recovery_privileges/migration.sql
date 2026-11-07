-- Override inherited table-wide defaults; original provenance remains immutable to runtime writers.
REVOKE ALL PRIVILEGES ON transcription_recovery_contexts, transcription_recovery_sources FROM daisy_web;
--> statement-breakpoint
GRANT SELECT, INSERT ON transcription_recovery_contexts, transcription_recovery_sources TO daisy_web;
--> statement-breakpoint
GRANT UPDATE (duration_ms,last_sequence,units,status,last_source_at,next_attempt_at,last_claimed_at,claim_epoch,worker_id,lease_digest,lease_expires_at,attempts,model,policy_digest,blocked_reason,selected_revision,selected_digest,selected_at) ON transcription_recovery_contexts TO daisy_web;
