CREATE TABLE "ai_allowance_grants" (
	"id" text PRIMARY KEY,
	"actor_id" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "ai_allowance_grants_period_check" CHECK ("period_end" > "period_start")
);
--> statement-breakpoint
CREATE TABLE "media_participants" (
	"id" text PRIMARY KEY,
	"session_id" text NOT NULL,
	"round_id" text NOT NULL,
	"round_participant_id" text NOT NULL,
	"identity" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_sessions" (
	"id" text PRIMARY KEY,
	"round_id" text NOT NULL,
	"room_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"reconcile_epoch" integer DEFAULT 0 NOT NULL,
	"reconcile_request_version" integer DEFAULT 0 NOT NULL,
	"reconcile_running_version" integer DEFAULT 0 NOT NULL,
	"reconcile_served_version" integer DEFAULT 0 NOT NULL,
	"reconcile_requested_at" timestamp with time zone,
	"reconcile_started_at" timestamp with time zone,
	"reconcile_completed_at" timestamp with time zone,
	"reconcile_lease_until" timestamp with time zone,
	"reconcile_owner" text,
	"unsafe_at" timestamp with time zone,
	"deletion_requested_at" timestamp with time zone,
	CONSTRAINT "media_sessions_reconcile_versions_check" CHECK ("reconcile_epoch" >= 0 and "reconcile_served_version" >= 0 and "reconcile_running_version" >= "reconcile_served_version" and "reconcile_request_version" >= "reconcile_running_version"),
	CONSTRAINT "media_sessions_reconcile_lease_check" CHECK (("reconcile_owner" is null) = ("reconcile_lease_until" is null)),
	CONSTRAINT "media_sessions_end_check" CHECK ("ended_at" is null or "ended_at" >= "created_at")
);
--> statement-breakpoint
CREATE TABLE "media_vendor_mutations" (
	"id" text PRIMARY KEY,
	"session_id" text NOT NULL,
	"epoch" integer NOT NULL,
	"kind" text NOT NULL,
	"identity" text,
	"dispatched_at" timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
	"settled_at" timestamp with time zone,
	"outcome" text,
	"payload" jsonb NOT NULL,
	CONSTRAINT "media_vendor_mutations_payload_is_object" CHECK (jsonb_typeof("payload") = 'object'),
	CONSTRAINT "media_vendor_mutations_epoch_check" CHECK ("epoch" >= 0),
	CONSTRAINT "media_vendor_mutations_kind_check" CHECK ("kind" in ('create','permissions','delete')),
	CONSTRAINT "media_vendor_mutations_identity_check" CHECK (("identity" is not null) = ("kind" = 'permissions')),
	CONSTRAINT "media_vendor_mutations_settlement_check" CHECK (("settled_at" is null) = ("outcome" is null) and ("outcome" is null or "outcome" in ('succeeded','failed')) and ("settled_at" is null or "settled_at" >= "dispatched_at")),
	CONSTRAINT "media_vendor_mutations_payload_check" CHECK (case when "kind" = 'permissions' then
    jsonb_typeof("payload") = 'object'
    and "payload" ?& array['publish','subscribe','hidden','capture']
    and ("payload" - 'publish' - 'subscribe' - 'hidden' - 'capture') = '{}'::jsonb
    and case when jsonb_typeof("payload"->'publish') = 'array' then
      jsonb_array_length("payload"->'publish') <= 2
      and ("payload"->'publish') <@ '["camera","microphone"]'::jsonb
      and (jsonb_array_length("payload"->'publish') < 2 or "payload"->'publish'->0 is distinct from "payload"->'publish'->1)
    else false end
    and jsonb_typeof("payload"->'subscribe') = 'boolean'
    and jsonb_typeof("payload"->'hidden') = 'boolean'
    and "payload"->'capture' = 'false'::jsonb
    else "payload" = '{}'::jsonb end)
);
--> statement-breakpoint
CREATE TABLE "round_attendance_adjudications" (
	"segment_id" text PRIMARY KEY,
	"round_id" text NOT NULL,
	"command_id" text NOT NULL,
	"decision" text NOT NULL,
	"effective_deadline" timestamp with time zone NOT NULL,
	"settled_horizon" timestamp with time zone NOT NULL,
	CONSTRAINT "round_attendance_adjudications_decision_check" CHECK ("decision" in ('attended', 'none', 'forfeit', 'abandoned'))
);
--> statement-breakpoint
CREATE TABLE "round_check_in_attempts" (
	"attempt_id" text PRIMARY KEY,
	"command_id" text NOT NULL,
	"round_id" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
	"backend_pid" integer NOT NULL,
	"backend_started_at" timestamp with time zone NOT NULL,
	"payload_digest" text NOT NULL,
	"actor_id" text,
	"service_id" text,
	"state" text DEFAULT 'pending' NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "round_check_in_attempts_state_check" CHECK ("state" in ('pending', 'committed', 'aborted')),
	CONSTRAINT "round_check_in_attempts_resolved_check" CHECK (("state"='pending' and "resolved_at" is null) or ("state"<>'pending' and "resolved_at" is not null)),
	CONSTRAINT "round_check_in_attempts_resolved_after_received" CHECK ("resolved_at" is null or "resolved_at" >= "received_at"),
	CONSTRAINT "round_check_in_attempts_backend_check" CHECK ("backend_pid">0),
	CONSTRAINT "round_check_in_attempts_digest_check" CHECK ("payload_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "round_check_in_attempts_one_principal" CHECK (("actor_id" is null) <> ("service_id" is null))
);
--> statement-breakpoint
CREATE TABLE "round_check_ins" (
	"command_id" text PRIMARY KEY,
	"round_id" text NOT NULL,
	"segment_id" text NOT NULL,
	"participant_id" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "round_bot_publications" (
	"round_id" text,
	"round_participant_id" text,
	"segment_id" text NOT NULL,
	"agent_run_id" text NOT NULL,
	"service_id" text NOT NULL,
	"publication_epoch" integer NOT NULL,
	"lease_token_digest" text NOT NULL,
	"lease_expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "round_bot_publications_pkey" PRIMARY KEY("round_id","round_participant_id"),
	CONSTRAINT "round_bot_publications_epoch_check" CHECK ("publication_epoch" > 0),
	CONSTRAINT "round_bot_publications_digest_check" CHECK ("lease_token_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "round_bot_publications_service_check" CHECK ("service_id" = 'agent-run:' || "agent_run_id")
);
--> statement-breakpoint
CREATE TABLE "round_judging_jobs" (
	"round_id" text,
	"freeze_revision" integer NOT NULL,
	"judge_participant_id" text,
	"status" text NOT NULL,
	"lease_token_digest" text,
	"lease_expires_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"result_ballot_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"command_id" text,
	"pending_ballot" jsonb,
	"pending_ballot_agent_run_id" text,
	"pending_ballot_epoch" integer,
	"pending_ballot_received_at" timestamp with time zone,
	CONSTRAINT "round_judging_jobs_pkey" PRIMARY KEY("round_id","judge_participant_id"),
	CONSTRAINT "round_judging_jobs_pending_ballot_is_object" CHECK (jsonb_typeof("pending_ballot") = 'object'),
	CONSTRAINT "round_judging_jobs_pending_check" CHECK (("pending_ballot" is null and "pending_ballot_agent_run_id" is null and "pending_ballot_epoch" is null and "pending_ballot_received_at" is null) or ("pending_ballot" is not null and "pending_ballot_agent_run_id" is not null and "pending_ballot_epoch" is not null and "pending_ballot_epoch" > 0 and "pending_ballot_epoch" <= "attempts" and "pending_ballot_received_at" is not null and "status" <> 'succeeded')),
	CONSTRAINT "round_judging_jobs_status_check" CHECK ("status" in ('queued', 'leased', 'succeeded', 'failed')),
	CONSTRAINT "round_judging_jobs_attempts_check" CHECK ("attempts" >= 0 and ("status" <> 'leased' or "attempts" > 0)),
	CONSTRAINT "round_judging_jobs_lease_check" CHECK (("status" = 'leased' and "lease_token_digest" is not null and "lease_expires_at" is not null) or ("status" <> 'leased' and "lease_token_digest" is null and "lease_expires_at" is null)),
	CONSTRAINT "round_judging_jobs_token_digest_check" CHECK ("lease_token_digest" is null or "lease_token_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "round_judging_jobs_result_check" CHECK (("status" = 'succeeded') = ("result_ballot_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "round_speaking_intervals" (
	"id" text PRIMARY KEY,
	"round_id" text NOT NULL,
	"segment_id" text NOT NULL,
	"round_participant_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"started_version" integer NOT NULL,
	"ended_version" integer,
	"started_command_id" text,
	"ended_command_id" text,
	CONSTRAINT "round_speaking_intervals_time_check" CHECK ("ended_at" is null or "ended_at" >= "started_at"),
	CONSTRAINT "round_speaking_intervals_version_check" CHECK ("started_version" > 0 and ("ended_version" is null or "ended_version" >= "started_version")),
	CONSTRAINT "round_speaking_intervals_close_pair" CHECK (("ended_at" is null) = ("ended_version" is null)),
	CONSTRAINT "round_speaking_intervals_ended_command_check" CHECK ("ended_command_id" is null or "ended_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "round_transcript_freezes" (
	"round_id" text PRIMARY KEY,
	"revision" integer NOT NULL,
	"frontier" integer NOT NULL,
	"frozen_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"completeness" text NOT NULL,
	CONSTRAINT "round_transcript_freezes_revision_check" CHECK ("revision" > 0 and "frontier" >= 0),
	CONSTRAINT "round_transcript_freezes_completeness_check" CHECK ("completeness" in ('complete', 'incomplete'))
);
--> statement-breakpoint
CREATE TABLE "availability_samples" (
	"at" timestamp with time zone PRIMARY KEY DEFAULT statement_timestamp(),
	"healthy" boolean NOT NULL,
	"cause" text,
	CONSTRAINT "availability_samples_cause_check" CHECK (("healthy" and "cause" is null) or (not "healthy" and "cause" is not null and "cause" in ('web_stale', 'realtime_stale', 'delivery_lag', 'public_probe_failed', 'check_in_pending')))
);
--> statement-breakpoint
CREATE TABLE "service_instances" (
	"instance_id" text PRIMARY KEY,
	"role" text NOT NULL,
	"renewed_at" timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
	"delivered_through" bigint,
	"delivered_through_txid" xid8,
	CONSTRAINT "service_instances_role_check" CHECK ("role" in ('web', 'realtime')),
	CONSTRAINT "service_instances_cursor_check" CHECK (("role"='web' and "delivered_through" is null and "delivered_through_txid" is null) or ("role"='realtime' and "delivered_through" is not null and "delivered_through" >= 0 and "delivered_through_txid" is not null and "delivered_through_txid"::text ~ '^[0-9]+$'))
);
--> statement-breakpoint
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
ALTER TABLE "utterances" DROP CONSTRAINT "utterances_generation_pair";--> statement-breakpoint
ALTER TABLE "ballots" ADD COLUMN "round_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "ballots" ADD COLUMN "freeze_revision" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "final_segment_ended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "transcript_admission_cutoff" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "ballot_deadline_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD COLUMN "reserved_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD COLUMN "refunded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "utterances" ADD COLUMN "clip_key" text;--> statement-breakpoint
ALTER TABLE "utterances" ADD COLUMN "capture_track_id" text;--> statement-breakpoint
ALTER TABLE "utterances" ADD COLUMN "capture_start_offset_ms" integer;--> statement-breakpoint
ALTER TABLE "utterances" ADD COLUMN "capture_duration_ms" integer;--> statement-breakpoint
ALTER TABLE "utterances" ADD COLUMN "capture_worker_epoch" integer;--> statement-breakpoint
ALTER TABLE "utterances" ADD COLUMN "capture_body_digest" text;--> statement-breakpoint
ALTER TABLE "utterances" DROP COLUMN "generation_token";--> statement-breakpoint
ALTER TABLE "utterances" DROP COLUMN "generation_expires_at";--> statement-breakpoint
CREATE UNIQUE INDEX "agent_runs_id_participant_unique" ON "agent_runs" ("id","round_participant_id");--> statement-breakpoint
CREATE INDEX "ai_allowance_grants_actor_period_idx" ON "ai_allowance_grants" ("actor_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX "ballots_judge_round_idx" ON "ballots" ("judge_participant_id","round_id");--> statement-breakpoint
CREATE INDEX "ballots_freeze_revision_idx" ON "ballots" ("round_id","freeze_revision");--> statement-breakpoint
CREATE UNIQUE INDEX "ballots_id_judge_unique" ON "ballots" ("id","judge_participant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_participants_seat_unique" ON "media_participants" ("session_id","round_participant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_participants_identity_unique" ON "media_participants" ("identity");--> statement-breakpoint
CREATE INDEX "media_participants_session_round_idx" ON "media_participants" ("session_id","round_id");--> statement-breakpoint
CREATE INDEX "media_participants_participant_round_idx" ON "media_participants" ("round_participant_id","round_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_sessions_round_unique" ON "media_sessions" ("round_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_sessions_room_unique" ON "media_sessions" ("room_name");--> statement-breakpoint
CREATE UNIQUE INDEX "media_sessions_id_round_unique" ON "media_sessions" ("id","round_id");--> statement-breakpoint
CREATE INDEX "media_vendor_mutations_session_settled_idx" ON "media_vendor_mutations" ("session_id","settled_at");--> statement-breakpoint
CREATE INDEX "media_vendor_mutations_pending_idx" ON "media_vendor_mutations" ("session_id","dispatched_at") WHERE "settled_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "round_attendance_adjudications_command_unique" ON "round_attendance_adjudications" ("command_id");--> statement-breakpoint
CREATE INDEX "round_attendance_adjudications_command_round_idx" ON "round_attendance_adjudications" ("command_id","round_id");--> statement-breakpoint
CREATE INDEX "round_attendance_adjudications_segment_round_idx" ON "round_attendance_adjudications" ("segment_id","round_id");--> statement-breakpoint
CREATE INDEX "round_attendance_adjudications_round_idx" ON "round_attendance_adjudications" ("round_id");--> statement-breakpoint
CREATE INDEX "round_check_in_attempts_round_state_idx" ON "round_check_in_attempts" ("round_id","state");--> statement-breakpoint
CREATE INDEX "round_check_in_attempts_pending_idx" ON "round_check_in_attempts" ("round_id","received_at") WHERE "state"='pending';--> statement-breakpoint
CREATE INDEX "round_check_in_attempts_command_round_idx" ON "round_check_in_attempts" ("command_id","round_id");--> statement-breakpoint
CREATE INDEX "round_check_in_attempts_actor_idx" ON "round_check_in_attempts" ("actor_id");--> statement-breakpoint
CREATE INDEX "round_check_in_attempts_resolved_idx" ON "round_check_in_attempts" ("resolved_at");--> statement-breakpoint
CREATE UNIQUE INDEX "round_check_ins_first_stamp_unique" ON "round_check_ins" ("round_id","segment_id","participant_id");--> statement-breakpoint
CREATE INDEX "round_check_ins_command_round_idx" ON "round_check_ins" ("command_id","round_id");--> statement-breakpoint
CREATE INDEX "round_check_ins_segment_round_idx" ON "round_check_ins" ("segment_id","round_id");--> statement-breakpoint
CREATE INDEX "round_check_ins_participant_round_idx" ON "round_check_ins" ("participant_id","round_id");--> statement-breakpoint
CREATE INDEX "round_bot_publications_seat_round_idx" ON "round_bot_publications" ("round_participant_id","round_id");--> statement-breakpoint
CREATE INDEX "round_bot_publications_segment_round_idx" ON "round_bot_publications" ("segment_id","round_id");--> statement-breakpoint
CREATE INDEX "round_bot_publications_run_seat_idx" ON "round_bot_publications" ("agent_run_id","round_participant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "round_commands_id_round_unique" ON "round_commands" ("command_id","round_id");--> statement-breakpoint
CREATE INDEX "round_judging_jobs_pending_run_judge_idx" ON "round_judging_jobs" ("pending_ballot_agent_run_id","judge_participant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "round_judging_jobs_command_unique" ON "round_judging_jobs" ("command_id");--> statement-breakpoint
CREATE INDEX "round_judging_jobs_freeze_revision_idx" ON "round_judging_jobs" ("round_id","freeze_revision");--> statement-breakpoint
CREATE INDEX "round_judging_jobs_judge_round_idx" ON "round_judging_jobs" ("judge_participant_id","round_id");--> statement-breakpoint
CREATE INDEX "round_judging_jobs_result_judge_idx" ON "round_judging_jobs" ("result_ballot_id","judge_participant_id");--> statement-breakpoint
CREATE INDEX "round_judging_jobs_pending_idx" ON "round_judging_jobs" ("status","lease_expires_at");--> statement-breakpoint
CREATE INDEX "round_speaking_intervals_segment_round_idx" ON "round_speaking_intervals" ("segment_id","round_id");--> statement-breakpoint
CREATE INDEX "round_speaking_intervals_participant_round_idx" ON "round_speaking_intervals" ("round_participant_id","round_id");--> statement-breakpoint
CREATE INDEX "round_speaking_intervals_history_idx" ON "round_speaking_intervals" ("round_id","segment_id","round_participant_id","started_at");--> statement-breakpoint
CREATE INDEX "round_speaking_intervals_started_command_idx" ON "round_speaking_intervals" ("started_command_id","round_id");--> statement-breakpoint
CREATE INDEX "round_speaking_intervals_ended_command_idx" ON "round_speaking_intervals" ("ended_command_id","round_id");--> statement-breakpoint
CREATE UNIQUE INDEX "round_transcript_freezes_round_revision_unique" ON "round_transcript_freezes" ("round_id","revision");--> statement-breakpoint
CREATE INDEX "service_instances_renewed_idx" ON "service_instances" ("renewed_at");--> statement-breakpoint
CREATE INDEX "transcript_observations_stream_round_idx" ON "transcript_observations" ("segment_id","round_participant_id","round_id","observed_from");--> statement-breakpoint
CREATE UNIQUE INDEX "transcript_segments_stream_round_unique" ON "transcript_segments" ("segment_id","round_participant_id","round_id");--> statement-breakpoint
CREATE INDEX "transcript_segments_segment_round_idx" ON "transcript_segments" ("segment_id","round_id");--> statement-breakpoint
CREATE INDEX "transcript_segments_participant_round_idx" ON "transcript_segments" ("round_participant_id","round_id");--> statement-breakpoint
CREATE INDEX "transcript_segments_round_idx" ON "transcript_segments" ("round_id");--> statement-breakpoint
CREATE INDEX "usage_reservations_actor_period_idx" ON "usage_reservations" ("actor_id","kind","reserved_at");--> statement-breakpoint
CREATE UNIQUE INDEX "utterances_capture_clip_unique" ON "utterances" ("clip_key");--> statement-breakpoint
CREATE UNIQUE INDEX "utterances_capture_position_unique" ON "utterances" ("segment_id","round_participant_id","capture_track_id","capture_start_offset_ms");--> statement-breakpoint
ALTER TABLE "ai_allowance_grants" ADD CONSTRAINT "ai_allowance_grants_actor_id_actors_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "ballots" ADD CONSTRAINT "ballots_round_fk" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ballots" ADD CONSTRAINT "ballots_judge_round_fk" FOREIGN KEY ("judge_participant_id","round_id") REFERENCES "round_participants"("id","round_id");--> statement-breakpoint
ALTER TABLE "ballots" ADD CONSTRAINT "ballots_freeze_revision_fk" FOREIGN KEY ("round_id","freeze_revision") REFERENCES "round_transcript_freezes"("round_id","revision");--> statement-breakpoint
ALTER TABLE "media_participants" ADD CONSTRAINT "media_participants_session_round_fk" FOREIGN KEY ("session_id","round_id") REFERENCES "media_sessions"("id","round_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "media_participants" ADD CONSTRAINT "media_participants_participant_round_fk" FOREIGN KEY ("round_participant_id","round_id") REFERENCES "round_participants"("id","round_id");--> statement-breakpoint
ALTER TABLE "media_sessions" ADD CONSTRAINT "media_sessions_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "media_vendor_mutations" ADD CONSTRAINT "media_vendor_mutations_session_id_media_sessions_id_fkey" FOREIGN KEY ("session_id") REFERENCES "media_sessions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "round_attendance_adjudications" ADD CONSTRAINT "round_attendance_adjudications_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "round_attendance_adjudications" ADD CONSTRAINT "round_attendance_adjudications_command_round_fk" FOREIGN KEY ("command_id","round_id") REFERENCES "round_commands"("command_id","round_id");--> statement-breakpoint
ALTER TABLE "round_attendance_adjudications" ADD CONSTRAINT "round_attendance_adjudications_segment_round_fk" FOREIGN KEY ("segment_id","round_id") REFERENCES "round_segments"("id","round_id");--> statement-breakpoint
ALTER TABLE "round_check_in_attempts" ADD CONSTRAINT "round_check_in_attempts_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "round_check_in_attempts" ADD CONSTRAINT "round_check_in_attempts_actor_id_actors_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id");--> statement-breakpoint
ALTER TABLE "round_check_ins" ADD CONSTRAINT "round_check_ins_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "round_check_ins" ADD CONSTRAINT "round_check_ins_command_round_fk" FOREIGN KEY ("command_id","round_id") REFERENCES "round_commands"("command_id","round_id");--> statement-breakpoint
ALTER TABLE "round_check_ins" ADD CONSTRAINT "round_check_ins_segment_round_fk" FOREIGN KEY ("segment_id","round_id") REFERENCES "round_segments"("id","round_id");--> statement-breakpoint
ALTER TABLE "round_check_ins" ADD CONSTRAINT "round_check_ins_participant_round_fk" FOREIGN KEY ("participant_id","round_id") REFERENCES "round_participants"("id","round_id");--> statement-breakpoint
ALTER TABLE "round_bot_publications" ADD CONSTRAINT "round_bot_publications_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "round_bot_publications" ADD CONSTRAINT "round_bot_publications_seat_round_fk" FOREIGN KEY ("round_participant_id","round_id") REFERENCES "round_participants"("id","round_id");--> statement-breakpoint
ALTER TABLE "round_bot_publications" ADD CONSTRAINT "round_bot_publications_segment_round_fk" FOREIGN KEY ("segment_id","round_id") REFERENCES "round_segments"("id","round_id");--> statement-breakpoint
ALTER TABLE "round_bot_publications" ADD CONSTRAINT "round_bot_publications_run_seat_fk" FOREIGN KEY ("agent_run_id","round_participant_id") REFERENCES "agent_runs"("id","round_participant_id");--> statement-breakpoint
ALTER TABLE "round_judging_jobs" ADD CONSTRAINT "round_judging_jobs_pending_run_judge_fk" FOREIGN KEY ("pending_ballot_agent_run_id","judge_participant_id") REFERENCES "agent_runs"("id","round_participant_id");--> statement-breakpoint
ALTER TABLE "round_judging_jobs" ADD CONSTRAINT "round_judging_jobs_freeze_revision_fk" FOREIGN KEY ("round_id","freeze_revision") REFERENCES "round_transcript_freezes"("round_id","revision") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "round_judging_jobs" ADD CONSTRAINT "round_judging_jobs_judge_round_fk" FOREIGN KEY ("judge_participant_id","round_id") REFERENCES "round_participants"("id","round_id");--> statement-breakpoint
ALTER TABLE "round_judging_jobs" ADD CONSTRAINT "round_judging_jobs_result_judge_fk" FOREIGN KEY ("result_ballot_id","judge_participant_id") REFERENCES "ballots"("id","judge_participant_id");--> statement-breakpoint
ALTER TABLE "round_speaking_intervals" ADD CONSTRAINT "round_speaking_intervals_segment_round_fk" FOREIGN KEY ("segment_id","round_id") REFERENCES "round_segments"("id","round_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "round_speaking_intervals" ADD CONSTRAINT "round_speaking_intervals_participant_round_fk" FOREIGN KEY ("round_participant_id","round_id") REFERENCES "round_participants"("id","round_id");--> statement-breakpoint
ALTER TABLE "round_speaking_intervals" ADD CONSTRAINT "round_speaking_intervals_started_command_round_fk" FOREIGN KEY ("started_command_id","round_id") REFERENCES "round_commands"("command_id","round_id");--> statement-breakpoint
ALTER TABLE "round_speaking_intervals" ADD CONSTRAINT "round_speaking_intervals_ended_command_round_fk" FOREIGN KEY ("ended_command_id","round_id") REFERENCES "round_commands"("command_id","round_id");--> statement-breakpoint
ALTER TABLE "round_transcript_freezes" ADD CONSTRAINT "round_transcript_freezes_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "media_worker_leases" ADD CONSTRAINT "media_worker_leases_session_id_media_sessions_id_fkey" FOREIGN KEY ("session_id") REFERENCES "media_sessions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "round_transcripts" ADD CONSTRAINT "round_transcripts_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "transcript_observations" ADD CONSTRAINT "transcript_observations_stream_round_fk" FOREIGN KEY ("segment_id","round_participant_id","round_id") REFERENCES "transcript_segments"("segment_id","round_participant_id","round_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD CONSTRAINT "transcript_segments_segment_round_fk" FOREIGN KEY ("segment_id","round_id") REFERENCES "round_segments"("id","round_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD CONSTRAINT "transcript_segments_participant_round_fk" FOREIGN KEY ("round_participant_id","round_id") REFERENCES "round_participants"("id","round_id");--> statement-breakpoint
ALTER TABLE "utterances" DROP CONSTRAINT "utterances_participant_round_fk", ADD CONSTRAINT "utterances_participant_round_fk" FOREIGN KEY ("round_participant_id","round_id") REFERENCES "round_participants"("id","round_id");--> statement-breakpoint
ALTER TABLE "ballots" ADD CONSTRAINT "ballots_freeze_revision_positive" CHECK ("freeze_revision" > 0);--> statement-breakpoint
ALTER TABLE "round_commands" ADD CONSTRAINT "round_commands_attendance_principal_check" CHECK ("type" <> 'adjudicate' or ("actor_id" is null and "service_id" ~ '^round-attendance:[a-z0-9]{24}$'));--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_transcript_cutoff_check" CHECK (("final_segment_ended_at" is null and "transcript_admission_cutoff" is null) or ("final_segment_ended_at" is not null and "transcript_admission_cutoff" is not null and "transcript_admission_cutoff" = "final_segment_ended_at" + interval '120 seconds'));--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD CONSTRAINT "usage_reservations_refund_check" CHECK ("refunded_at" is null or ("counted_at" is not null and "refunded_at" >= "counted_at"));--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD CONSTRAINT "usage_reservations_admission_check" CHECK ("counted_at" is null or "counted_at" >= "reserved_at");--> statement-breakpoint
ALTER TABLE "utterances" ADD CONSTRAINT "utterances_capture_pair_check" CHECK (("clip_key" is null and "capture_track_id" is null and "capture_start_offset_ms" is null and "capture_duration_ms" is null and "capture_worker_epoch" is null and "capture_body_digest" is null) or ("clip_key" is not null and "capture_track_id" is not null and "capture_start_offset_ms" is not null and "capture_duration_ms" is not null and "capture_worker_epoch" is not null and "capture_body_digest" is not null));--> statement-breakpoint
ALTER TABLE "utterances" ADD CONSTRAINT "utterances_capture_metadata_check" CHECK ("clip_key" is null or ("clip_key" ~ '^[0-9a-f]{64}$' and "capture_body_digest" ~ '^[0-9a-f]{64}$' and char_length("capture_track_id") between 1 and 128 and "capture_start_offset_ms" >= 0 and "capture_duration_ms" > 0 and "capture_duration_ms" <= 60000 and "capture_worker_epoch" > 0));--> statement-breakpoint
ALTER TABLE "round_commands" DROP CONSTRAINT "round_commands_type_check", ADD CONSTRAINT "round_commands_type_check" CHECK ("type" in ('start', 'start_prep', 'start_speech', 'yield', 'interrupt', 'forfeit', 'complete', 'submit_ballot', 'check_in', 'adjudicate'));--> statement-breakpoint
ALTER TABLE "rounds" DROP CONSTRAINT "rounds_lifecycle_check", ADD CONSTRAINT "rounds_lifecycle_check" CHECK (("status" = 'scheduled' and "current_stage" is null and "outcome" is null and "started_at" is null and "completed_at" is null) or ("status" = 'active' and "current_stage" is not null and "outcome" is null and "started_at" is not null and "completed_at" is null) or ("status" = 'completed' and "current_stage" is null and ("outcome" is not null or ("competition_type" = 'casual' and "ladder_id" is null)) and "started_at" is not null and "completed_at" is not null) or ("status" = 'abandoned' and "current_stage" is null and "outcome" is null and "completed_at" is not null));--> statement-breakpoint
-- Hand-written objects carried over from the consolidated receiver migrations, in their original order.
-- from 20261022052521_rapid_strong_guy
-- Drizzle 1.0.0-rc.4 cannot represent exclusion constraints. PostgreSQL's
-- trusted bundled btree_gist supplies text equality beside tstzrange overlap.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE round_speaking_intervals ADD CONSTRAINT round_speaking_intervals_no_overlap
EXCLUDE USING gist (
  segment_id WITH =,
  round_participant_id WITH =,
  tstzrange(started_at, ended_at, '[)') WITH &&
);
--> statement-breakpoint
-- from 20261022052806_foamy_overlord
CREATE FUNCTION refuse_round_transcript_freeze_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'A transcript freeze is immutable'
    USING ERRCODE = '23514', CONSTRAINT = 'round_transcript_freezes_immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER round_transcript_freezes_immutable
BEFORE UPDATE ON round_transcript_freezes
FOR EACH ROW EXECUTE FUNCTION refuse_round_transcript_freeze_update();
--> statement-breakpoint
-- from 20261022054213_round_child_integrity
-- Scoped references cross multiple Round-owned cascade branches. Check them at
-- transaction end, after every owned branch is gone; direct deletions still fail.
ALTER TABLE media_participants ALTER CONSTRAINT media_participants_participant_round_fk DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE round_speaking_intervals ALTER CONSTRAINT round_speaking_intervals_participant_round_fk DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE round_speaking_intervals ALTER CONSTRAINT round_speaking_intervals_started_command_round_fk DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE round_speaking_intervals ALTER CONSTRAINT round_speaking_intervals_ended_command_round_fk DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE round_judging_jobs ALTER CONSTRAINT round_judging_jobs_judge_round_fk DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE round_judging_jobs ALTER CONSTRAINT round_judging_jobs_result_judge_fk DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
-- from 20261022054820_neat_franklin_storm
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
--> statement-breakpoint
-- from 20261022055029_furry_skullbuster
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
--> statement-breakpoint
-- from 20261022062454_sour_pretty_boy
-- Utterances and seats are separate owning-Round cascade branches. Scoped
-- consistency is checked after both branches; direct seat deletion still fails.
ALTER TABLE utterances ALTER CONSTRAINT utterances_participant_round_fk DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
-- from 20261022063105_chilly_radioactive_man
CREATE FUNCTION refuse_ballot_freeze_rewrite() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.round_id IS DISTINCT FROM OLD.round_id OR
     NEW.freeze_revision IS DISTINCT FROM OLD.freeze_revision THEN
    RAISE EXCEPTION 'Frozen ballot provenance is immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'ballots_freeze_immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ballots_freeze_immutable
BEFORE UPDATE ON ballots
FOR EACH ROW EXECUTE FUNCTION refuse_ballot_freeze_rewrite();
--> statement-breakpoint
-- from 20261022063359_short_iron_monger
-- Separate owning-Round cascades may delete seats before ballots. Standalone
-- seat/freeze deletion still fails at commit; only owning Round erasure cascades.
ALTER TABLE ballots ALTER CONSTRAINT ballots_judge_seat_fk DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE ballots ALTER CONSTRAINT ballots_judge_round_fk DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE ballots ALTER CONSTRAINT ballots_freeze_revision_fk DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
-- from 20261022064055_familiar_white_tiger
CREATE FUNCTION refuse_judging_intent_rewrite() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.round_id IS DISTINCT FROM OLD.round_id OR
     NEW.judge_participant_id IS DISTINCT FROM OLD.judge_participant_id OR
     NEW.freeze_revision IS DISTINCT FROM OLD.freeze_revision THEN
    RAISE EXCEPTION 'A judging intent has immutable identity'
      USING ERRCODE = '23514', CONSTRAINT = 'round_judging_jobs_identity_immutable';
  END IF;
  IF OLD.command_id IS NOT NULL AND NEW.command_id IS DISTINCT FROM OLD.command_id THEN
    RAISE EXCEPTION 'A judging command identifier is allocated once'
      USING ERRCODE = '23514', CONSTRAINT = 'round_judging_jobs_command_immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER round_judging_jobs_identity_immutable
BEFORE UPDATE ON round_judging_jobs
FOR EACH ROW EXECUTE FUNCTION refuse_judging_intent_rewrite();
--> statement-breakpoint
-- from 20261022064231_brown_jackpot
ALTER TABLE round_bot_publications ALTER CONSTRAINT round_bot_publications_seat_round_fk DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE round_bot_publications ALTER CONSTRAINT round_bot_publications_segment_round_fk DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE round_bot_publications ALTER CONSTRAINT round_bot_publications_run_seat_fk DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE FUNCTION fence_bot_publication_epoch() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.round_id IS DISTINCT FROM OLD.round_id OR
     NEW.round_participant_id IS DISTINCT FROM OLD.round_participant_id THEN
    RAISE EXCEPTION 'Publication seat identity is immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'round_bot_publications_identity_immutable';
  END IF;
  IF NEW.publication_epoch < OLD.publication_epoch OR
     (NEW.publication_epoch = OLD.publication_epoch AND
       (NEW.segment_id IS DISTINCT FROM OLD.segment_id OR
        NEW.agent_run_id IS DISTINCT FROM OLD.agent_run_id OR
        NEW.service_id IS DISTINCT FROM OLD.service_id OR
        NEW.lease_token_digest IS DISTINCT FROM OLD.lease_token_digest)) OR
     (NEW.publication_epoch > OLD.publication_epoch AND
       (NEW.publication_epoch::bigint <> OLD.publication_epoch::bigint + 1 OR
        NEW.agent_run_id = OLD.agent_run_id OR
        NEW.lease_token_digest = OLD.lease_token_digest)) THEN
    RAISE EXCEPTION 'Publication epoch must preserve identity or advance once for a new run'
      USING ERRCODE = '23514', CONSTRAINT = 'round_bot_publications_epoch_immutable';
  END IF;
  IF NEW.publication_epoch = OLD.publication_epoch AND
     OLD.lease_expires_at <= clock_timestamp() AND
     NEW.lease_expires_at > OLD.lease_expires_at THEN
    RAISE EXCEPTION 'An expired publication lease cannot be renewed'
      USING ERRCODE = '23514', CONSTRAINT = 'round_bot_publications_lease_revoked';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER round_bot_publications_epoch_fence
BEFORE UPDATE ON round_bot_publications
FOR EACH ROW EXECUTE FUNCTION fence_bot_publication_epoch();
--> statement-breakpoint
-- from 20261022065033_flashy_sage
-- btree_gist is provided by the earlier speaking-history migration.
ALTER TABLE ai_allowance_grants ADD CONSTRAINT ai_allowance_grants_no_overlap
EXCLUDE USING gist (actor_id WITH =, tstzrange(period_start, period_end, '[)') WITH &&)
WHERE (revoked_at IS NULL);
--> statement-breakpoint
-- from 20261022072911_legal_fixer
ALTER TABLE round_attendance_adjudications ALTER CONSTRAINT round_attendance_adjudications_command_round_fk DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE round_attendance_adjudications ALTER CONSTRAINT round_attendance_adjudications_segment_round_fk DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE round_check_ins ALTER CONSTRAINT round_check_ins_command_round_fk DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE round_check_ins ALTER CONSTRAINT round_check_ins_segment_round_fk DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE round_check_ins ALTER CONSTRAINT round_check_ins_participant_round_fk DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE round_check_in_attempts ALTER CONSTRAINT round_check_in_attempts_actor_id_actors_id_fkey DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE FUNCTION bind_service_instance_role() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND
     (NEW.instance_id IS DISTINCT FROM OLD.instance_id OR NEW.role IS DISTINCT FROM OLD.role) THEN
    RAISE EXCEPTION 'Service instance identity is immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'service_instances_identity_immutable';
  END IF;
  IF (current_user = 'daisy_realtime' AND
        (NEW.role <> 'realtime' OR (TG_OP = 'UPDATE' AND OLD.role <> 'realtime'))) OR
     (current_user = 'daisy_web' AND
        (NEW.role <> 'web' OR (TG_OP = 'UPDATE' AND OLD.role <> 'web'))) THEN
    RAISE EXCEPTION 'Service role cannot impersonate a peer role' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER service_instances_role_binding BEFORE INSERT OR UPDATE ON service_instances
FOR EACH ROW EXECUTE FUNCTION bind_service_instance_role();
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON service_instances TO daisy_realtime;
--> statement-breakpoint
CREATE FUNCTION guard_availability_sample() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Availability history is immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'availability_samples_immutable';
  END IF;
  IF NOT pg_try_advisory_xact_lock(59003) THEN
    RAISE EXCEPTION 'Availability sampler is already elected' USING ERRCODE = '55P03';
  END IF;
  IF NEW.at <= (SELECT max(at) FROM availability_samples) THEN
    RAISE EXCEPTION 'Availability time must advance'
      USING ERRCODE = '23514', CONSTRAINT = 'availability_samples_monotone';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER availability_samples_order BEFORE INSERT OR UPDATE ON availability_samples
FOR EACH ROW EXECUTE FUNCTION guard_availability_sample();
--> statement-breakpoint
CREATE FUNCTION guard_round_attendance_fact() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_type text;
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM rounds WHERE id=OLD.round_id) THEN
    RETURN OLD;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Round attendance evidence is immutable'
      USING ERRCODE = '23514', CONSTRAINT = TG_TABLE_NAME || '_immutable';
  END IF;
  expected_type := CASE WHEN TG_TABLE_NAME = 'round_check_ins' THEN 'check_in' ELSE 'adjudicate' END;
  IF NOT EXISTS (SELECT 1 FROM round_commands c WHERE c.command_id=NEW.command_id
    AND c.round_id=NEW.round_id AND c.type=expected_type) THEN
    RAISE EXCEPTION 'Attendance receipt type is not authoritative'
      USING ERRCODE = '23514', CONSTRAINT = TG_TABLE_NAME || '_receipt_type';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER round_check_ins_immutable BEFORE INSERT OR UPDATE OR DELETE ON round_check_ins
FOR EACH ROW EXECUTE FUNCTION guard_round_attendance_fact();
--> statement-breakpoint
CREATE TRIGGER round_attendance_adjudications_immutable BEFORE INSERT OR UPDATE OR DELETE ON round_attendance_adjudications
FOR EACH ROW EXECUTE FUNCTION guard_round_attendance_fact();
--> statement-breakpoint
CREATE FUNCTION guard_round_check_in_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.state = 'pending' AND EXISTS (SELECT 1 FROM rounds WHERE id=OLD.round_id) THEN
      RAISE EXCEPTION 'An unresolved check-in attempt cannot be pruned'
        USING ERRCODE = '23514', CONSTRAINT = 'round_check_in_attempts_pending';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.state <> 'pending' OR NEW.state = 'pending' OR
     ROW(NEW.attempt_id,NEW.command_id,NEW.round_id,NEW.received_at,NEW.backend_pid,
         NEW.backend_started_at,NEW.payload_digest,NEW.actor_id,NEW.service_id) IS DISTINCT FROM
     ROW(OLD.attempt_id,OLD.command_id,OLD.round_id,OLD.received_at,OLD.backend_pid,
         OLD.backend_started_at,OLD.payload_digest,OLD.actor_id,OLD.service_id) THEN
    RAISE EXCEPTION 'Check-in attempt identity and resolved outcome are immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'round_check_in_attempts_immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER round_check_in_attempts_resolution BEFORE UPDATE OR DELETE ON round_check_in_attempts
FOR EACH ROW EXECUTE FUNCTION guard_round_check_in_attempt();
--> statement-breakpoint
-- from 20261022075046_closed_bloodstrike
CREATE FUNCTION guard_media_vendor_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.settled_at IS NULL AND EXISTS (SELECT 1 FROM media_sessions WHERE id=OLD.session_id) THEN
      RAISE EXCEPTION 'Pending vendor intent cannot be erased' USING ERRCODE='23514', CONSTRAINT='media_vendor_mutations_pending';
    END IF;
    RETURN OLD;
  END IF;
  IF ROW(NEW.id,NEW.session_id,NEW.epoch,NEW.kind,NEW.identity,NEW.dispatched_at,NEW.payload)
    IS DISTINCT FROM ROW(OLD.id,OLD.session_id,OLD.epoch,OLD.kind,OLD.identity,OLD.dispatched_at,OLD.payload)
    OR OLD.settled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Vendor intent and known outcomes are immutable' USING ERRCODE='23514', CONSTRAINT='media_vendor_mutations_immutable';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER media_vendor_mutation_guard BEFORE UPDATE OR DELETE ON media_vendor_mutations FOR EACH ROW EXECUTE FUNCTION guard_media_vendor_mutation();
--> statement-breakpoint
CREATE FUNCTION guard_media_session_reconciliation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reconcile_epoch < OLD.reconcile_epoch
    OR NEW.reconcile_request_version < OLD.reconcile_request_version
    OR NEW.reconcile_running_version < OLD.reconcile_running_version
    OR NEW.reconcile_served_version < OLD.reconcile_served_version THEN
    RAISE EXCEPTION 'Reconciliation fences cannot decrease' USING ERRCODE='23514', CONSTRAINT='media_sessions_reconcile_epoch_immutable';
  END IF;
  IF OLD.unsafe_at IS NOT NULL AND NEW.unsafe_at IS NULL
    AND EXISTS (SELECT 1 FROM media_vendor_mutations WHERE session_id=OLD.id AND settled_at IS NULL) THEN
    RAISE EXCEPTION 'Unresolved vendor intent blocks reopening' USING ERRCODE='23514', CONSTRAINT='media_sessions_pending_unsafe';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER media_session_reconciliation_guard BEFORE UPDATE ON media_sessions FOR EACH ROW EXECUTE FUNCTION guard_media_session_reconciliation();
--> statement-breakpoint
-- from 20261022080456_keen_monster_badoon
ALTER TABLE round_judging_jobs ALTER CONSTRAINT round_judging_jobs_pending_run_judge_fk DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE FUNCTION guard_pending_judging_response() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.pending_ballot IS NOT NULL THEN
    IF NEW.pending_ballot IS NULL THEN
      IF NEW.status <> 'succeeded' OR NOT EXISTS (
        SELECT 1 FROM ballots WHERE id=NEW.result_ballot_id
          AND judge_participant_id=OLD.judge_participant_id
          AND round_id=OLD.round_id AND freeze_revision=OLD.freeze_revision
          AND status='submitted'
      ) THEN
        RAISE EXCEPTION 'A pending response clears only with its committed ballot'
          USING ERRCODE='23514', CONSTRAINT='round_judging_jobs_pending_immutable';
      END IF;
    ELSIF ROW(NEW.pending_ballot,NEW.pending_ballot_agent_run_id,NEW.pending_ballot_epoch,NEW.pending_ballot_received_at)
      IS DISTINCT FROM ROW(OLD.pending_ballot,OLD.pending_ballot_agent_run_id,OLD.pending_ballot_epoch,OLD.pending_ballot_received_at) THEN
      RAISE EXCEPTION 'Pending response provenance is immutable across takeover'
        USING ERRCODE='23514', CONSTRAINT='round_judging_jobs_pending_immutable';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER round_judging_jobs_pending_guard BEFORE UPDATE ON round_judging_jobs FOR EACH ROW EXECUTE FUNCTION guard_pending_judging_response();
--> statement-breakpoint
-- from 20261022082044_pending_judging_retention
CREATE FUNCTION refuse_pending_judging_erasure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.pending_ballot IS NOT NULL AND EXISTS (SELECT 1 FROM rounds WHERE id=OLD.round_id) THEN
    RAISE EXCEPTION 'A validated pending judging response remains until ballot success or owning Round erasure'
      USING ERRCODE='23514', CONSTRAINT='round_judging_jobs_pending_delete';
  END IF;
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER round_judging_jobs_pending_delete
BEFORE DELETE ON round_judging_jobs
FOR EACH ROW EXECUTE FUNCTION refuse_pending_judging_erasure();
--> statement-breakpoint
-- from 20261022092624_faulty_the_hand
-- DEC-191: actual judge seats are cross-row facts, so a CHECK alone cannot
-- witness zero judges. Serialize deferred seat admission with Round completion;
-- the lock is separate from the fresh fact query to close concurrent insertion.
CREATE FUNCTION guard_unjudged_round_participants() RETURNS trigger LANGUAGE plpgsql AS $$
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
      AND EXISTS (SELECT 1 FROM round_participants p WHERE p.round_id = r.id AND p.role = 'judge')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'rounds_unjudged_participants_check', MESSAGE = 'Unjudged completion cannot contain judge seats';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER rounds_unjudged_participants_check
AFTER INSERT OR UPDATE ON rounds DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW WHEN (NEW.status = 'completed' AND NEW.outcome IS NULL)
EXECUTE FUNCTION guard_unjudged_round_participants();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER round_participants_unjudged_completion_check
AFTER INSERT OR UPDATE ON round_participants DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW WHEN (NEW.role = 'judge')
EXECUTE FUNCTION guard_unjudged_round_participants();
--> statement-breakpoint
-- from 20261022120730_media_worker_role
--> daisy_media_worker: the capture worker's only credential (ADR 0053,
--> VIDEO-3.13). SELECT on the capture authority it discovers sessions from
--> and on the lease table, so discovery skips live leases. No write anywhere:
--> leases, utterances, observations and seals change only through the signed
--> apps/web path, under the Round -> lease -> stream lock order. Explicit
--> grants only: default privileges never reach it. No password is set;
--> production provisions the credential out of band (VIDEO-4.2).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'daisy_media_worker') THEN
    CREATE ROLE daisy_media_worker LOGIN;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO daisy_media_worker;
--> statement-breakpoint
GRANT SELECT ON rounds, round_participants, round_segments, media_sessions, media_participants, media_worker_leases TO daisy_media_worker;
--> statement-breakpoint
-- from 20261023000508_ballot_deadline_no_ruling
-- DEC-201/DEC-207: a Round with judge seats may complete without a winner only
-- once the database clock at commit reaches the ballot deadline persisted at
-- its freeze, never by a writer-supplied completed_at; a zero-judge Round keeps
-- DEC-191's guarantee. The same deferred triggers fence both rows.
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
      AND EXISTS (SELECT 1 FROM round_participants p WHERE p.round_id = r.id AND p.role = 'judge')
      AND (r.ballot_deadline_at IS NULL OR clock_timestamp() < r.ballot_deadline_at)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'rounds_unjudged_participants_check', MESSAGE = 'A judged Round completes without a winner only at its ballot deadline';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION guard_round_ballot_deadline() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.ballot_deadline_at IS NOT NULL AND NEW.ballot_deadline_at IS DISTINCT FROM OLD.ballot_deadline_at THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'rounds_ballot_deadline_immutable', MESSAGE = 'A persisted ballot deadline is immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER rounds_ballot_deadline_immutable BEFORE UPDATE ON rounds
FOR EACH ROW EXECUTE FUNCTION guard_round_ballot_deadline();
