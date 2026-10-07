CREATE TABLE "actors" (
	"id" text PRIMARY KEY,
	"kind" text NOT NULL,
	"user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "actors_kind_check" CHECK ("kind" in ('human', 'bot')),
	CONSTRAINT "actors_human_has_user" CHECK ("kind" <> 'human' or "user_id" is not null),
	CONSTRAINT "actors_version_positive" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" text PRIMARY KEY,
	"round_participant_id" text NOT NULL,
	"kind" text NOT NULL,
	"model" text,
	"provider" text NOT NULL,
	"configuration_snapshot" jsonb DEFAULT '{}' NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"characters" integer DEFAULT 0 NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "agent_runs_kind_check" CHECK ("kind" in ('speech', 'cross_ex', 'tts', 'stt', 'judging')),
	CONSTRAINT "agent_runs_usage_nonnegative" CHECK ("input_tokens" >= 0 and "output_tokens" >= 0 and "characters" >= 0 and "requests" >= 0),
	CONSTRAINT "agent_runs_configuration_snapshot_is_object" CHECK (jsonb_typeof("configuration_snapshot") = 'object')
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passkey" (
	"id" text PRIMARY KEY,
	"name" text,
	"public_key" text NOT NULL,
	"user_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"counter" integer NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"aaguid" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ballots" (
	"id" text PRIMARY KEY,
	"judge_participant_id" text NOT NULL,
	"rubric_version" text NOT NULL,
	"winner" text NOT NULL,
	"scores" jsonb NOT NULL,
	"reason" text NOT NULL,
	"feedback" jsonb,
	"citations" jsonb,
	"status" text NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by_actor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ballots_status_check" CHECK ("status" in ('submitted', 'voided')),
	CONSTRAINT "ballots_winner_check" CHECK ("winner" in ('affirmative', 'negative')),
	CONSTRAINT "ballots_rubric_version_check" CHECK ("rubric_version" = 'speaker-10@1'),
	CONSTRAINT "ballots_voided_fields_check" CHECK (("status" = 'voided' and "voided_at" is not null and "voided_by_actor_id" is not null) or ("status" <> 'voided' and "voided_at" is null and "voided_by_actor_id" is null)),
	CONSTRAINT "ballots_voided_after_submitted" CHECK ("voided_at" is null or "voided_at" >= "submitted_at"),
	CONSTRAINT "ballots_scores_is_object" CHECK (jsonb_typeof("scores") = 'object')
);
--> statement-breakpoint
CREATE TABLE "bot_profiles" (
	"actor_id" text PRIMARY KEY,
	"name" text NOT NULL,
	"persona" text NOT NULL,
	"voice" text NOT NULL,
	"difficulty" text DEFAULT 'beginner' NOT NULL,
	CONSTRAINT "bot_profiles_difficulty_check" CHECK ("difficulty" in ('beginner', 'intermediate', 'advanced'))
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY,
	"owner_actor_id" text NOT NULL,
	"title" text NOT NULL,
	"html" text NOT NULL,
	"template_id" text NOT NULL,
	"folder" text DEFAULT 'library' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_folder_check" CHECK ("folder" in ('library', 'scratch')),
	CONSTRAINT "documents_template_check" CHECK ("template_id" in ('blank', 'flow', 'cross-ex', 'speech-plan', 'case', 'block', 'evidence')),
	CONSTRAINT "documents_title_length" CHECK (char_length("title") between 1 and 120),
	CONSTRAINT "documents_revision_positive" CHECK ("revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "round_document_refs" (
	"round_id" text,
	"document_id" text,
	"role" text NOT NULL,
	"pinned_revision" integer,
	CONSTRAINT "round_document_refs_pkey" PRIMARY KEY("round_id","document_id"),
	CONSTRAINT "round_document_refs_role_check" CHECK ("role" in ('flow', 'case', 'evidence', 'notes'))
);
--> statement-breakpoint
CREATE TABLE "email_delivery" (
	"id" text PRIMARY KEY,
	"provider_message_id" text NOT NULL,
	"recipient_hash" text NOT NULL,
	"status" text NOT NULL,
	"status_rank" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_delivery_status_check" CHECK (("status", "status_rank") in (('sent', 1), ('delayed', 2), ('delivered', 3), ('failed', 4), ('bounced', 5), ('complained', 6)))
);
--> statement-breakpoint
CREATE TABLE "email_delivery_event" (
	"provider_event_id" text PRIMARY KEY,
	"provider_message_id" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_suppression" (
	"recipient_hash" text PRIMARY KEY,
	"reason" text NOT NULL,
	"provider_message_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_suppression_reason_check" CHECK ("reason" in ('bounce', 'complaint'))
);
--> statement-breakpoint
CREATE TABLE "format_presets" (
	"format_id" text,
	"length" text,
	"version" integer,
	"format_version" integer NOT NULL,
	"config" jsonb NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	CONSTRAINT "format_presets_pkey" PRIMARY KEY("format_id","length","version"),
	CONSTRAINT "format_presets_length_check" CHECK ("length" in ('full', 'quick')),
	CONSTRAINT "format_presets_version_positive" CHECK ("version" > 0),
	CONSTRAINT "format_presets_format_version_positive" CHECK ("format_version" > 0),
	CONSTRAINT "format_presets_config_is_object" CHECK (jsonb_typeof("config") = 'object')
);
--> statement-breakpoint
CREATE TABLE "format_revisions" (
	"format_id" text,
	"version" integer,
	"definition" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "format_revisions_pkey" PRIMARY KEY("format_id","version"),
	CONSTRAINT "format_revisions_definition_is_object" CHECK (jsonb_typeof("definition") = 'object'),
	CONSTRAINT "format_revisions_version_positive" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE TABLE "formats" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"current_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "formats_current_version_positive" CHECK ("current_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "member_interests" (
	"user_id" text,
	"interest" text,
	CONSTRAINT "member_interests_pkey" PRIMARY KEY("user_id","interest"),
	CONSTRAINT "member_interests_interest_check" CHECK ("interest" in ('debate', 'coach', 'judge', 'watch'))
);
--> statement-breakpoint
CREATE TABLE "member_onboarding" (
	"user_id" text PRIMARY KEY,
	"club" text,
	"experience" text,
	"formats" text[] DEFAULT '{}'::text[] NOT NULL,
	"length" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "member_onboarding_club_check" CHECK ("club" is null or "club" in ('joining', 'starting', 'own')),
	CONSTRAINT "member_onboarding_experience_check" CHECK ("experience" is null or "experience" in ('new', 'class', 'circuit', 'veteran')),
	CONSTRAINT "member_onboarding_formats_check" CHECK ("formats" <@ array['one-on-one', 'teams']::text[]),
	CONSTRAINT "member_onboarding_length_check" CHECK ("length" is null or "length" in ('quick', 'full')),
	CONSTRAINT "member_onboarding_version_positive" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE TABLE "member_topics" (
	"user_id" text,
	"topic" text,
	CONSTRAINT "member_topics_pkey" PRIMARY KEY("user_id","topic"),
	CONSTRAINT "member_topics_topic_check" CHECK ("topic" in ('politics', 'economics', 'philosophy', 'ethics', 'law', 'science-and-tech', 'environment', 'education', 'health', 'international', 'culture', 'sports'))
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"seq" bigserial PRIMARY KEY,
	"txid" xid8 DEFAULT pg_current_xact_id() NOT NULL,
	"topic" text NOT NULL,
	"kind" text NOT NULL,
	"version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
	CONSTRAINT "outbox_payload_is_object" CHECK (jsonb_typeof("payload") = 'object')
);
--> statement-breakpoint
CREATE TABLE "rating_changes" (
	"id" text PRIMARY KEY,
	"round_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"format_id" text NOT NULL,
	"season_id" text NOT NULL,
	"ladder" text NOT NULL,
	"rating_before" double precision NOT NULL,
	"rating_after" double precision NOT NULL,
	"deviation_before" double precision NOT NULL,
	"deviation_after" double precision NOT NULL,
	"volatility_before" double precision NOT NULL,
	"volatility_after" double precision NOT NULL,
	"calculation_version" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "rating_changes_ladder_check" CHECK ("ladder" in ('ranked', 'quick')),
	CONSTRAINT "rating_changes_rating_range" CHECK ("rating_before" between 0 and 4000 and "rating_after" between 0 and 4000),
	CONSTRAINT "rating_changes_deviation_positive" CHECK ("deviation_before" > 0 and "deviation_before" < 'infinity'::double precision and "deviation_after" > 0 and "deviation_after" < 'infinity'::double precision),
	CONSTRAINT "rating_changes_volatility_positive" CHECK ("volatility_before" > 0 and "volatility_before" < 'infinity'::double precision and "volatility_after" > 0 and "volatility_after" < 'infinity'::double precision)
);
--> statement-breakpoint
CREATE TABLE "ratings" (
	"actor_id" text,
	"format_id" text,
	"season_id" text,
	"ladder" text,
	"rating" double precision NOT NULL,
	"deviation" double precision NOT NULL,
	"volatility" double precision NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "ratings_pkey" PRIMARY KEY("actor_id","format_id","season_id","ladder"),
	CONSTRAINT "ratings_ladder_check" CHECK ("ladder" in ('ranked', 'quick')),
	CONSTRAINT "ratings_rating_range" CHECK ("rating" between 0 and 4000),
	CONSTRAINT "ratings_deviation_positive" CHECK ("deviation" > 0 and "deviation" < 'infinity'::double precision),
	CONSTRAINT "ratings_volatility_positive" CHECK ("volatility" > 0 and "volatility" < 'infinity'::double precision),
	CONSTRAINT "ratings_version_positive" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "seasons_ends_after_starts" CHECK ("ends_at" is null or "ends_at" > "starts_at"),
	CONSTRAINT "seasons_status_check" CHECK ("status" in ('scheduled', 'active', 'closed')),
	CONSTRAINT "seasons_version_positive" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE TABLE "role_grants" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" text,
	"granted_by_user_id" text,
	"granted_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "role_grants_role_check" CHECK ("role" in ('moderator', 'judge')),
	CONSTRAINT "role_grants_scope_type_check" CHECK ("scope_type" in ('global')),
	CONSTRAINT "role_grants_global_scope_check" CHECK ("scope_type" <> 'global' or "scope_id" is null),
	CONSTRAINT "role_grants_revoked_after_granted" CHECK ("revoked_at" is null or "revoked_at" >= "granted_at")
);
--> statement-breakpoint
CREATE TABLE "room_participants" (
	"id" text PRIMARY KEY,
	"room_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"role" text NOT NULL,
	"slot" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "room_participants_role_check" CHECK ("role" in ('affirmative', 'negative', 'judge')),
	CONSTRAINT "room_participants_slot_check" CHECK ("slot" >= 0)
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" text PRIMARY KEY,
	"format_id" text NOT NULL,
	"format_version" integer NOT NULL,
	"preset_version" integer,
	"competition_type" text NOT NULL,
	"length" text NOT NULL,
	"config" jsonb NOT NULL,
	"execution_plan" jsonb NOT NULL,
	"rules_snapshot" jsonb NOT NULL,
	"prep_started_at" timestamp with time zone,
	"prep_remaining_ms" integer,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rooms_id_format_unique" UNIQUE("id","format_id"),
	CONSTRAINT "rooms_status_check" CHECK ("status" in ('assembling', 'ready', 'started', 'abandoned')),
	CONSTRAINT "rooms_competition_type_check" CHECK ("competition_type" in ('ranked', 'casual', 'practice')),
	CONSTRAINT "rooms_length_check" CHECK ("length" in ('full', 'quick')),
	CONSTRAINT "rooms_ranked_has_preset_check" CHECK (("competition_type" = 'ranked') = ("preset_version" is not null)),
	CONSTRAINT "rooms_config_is_object" CHECK (jsonb_typeof("config") = 'object'),
	CONSTRAINT "rooms_execution_plan_is_object" CHECK (jsonb_typeof("execution_plan") = 'object'),
	CONSTRAINT "rooms_rules_snapshot_is_object" CHECK (jsonb_typeof("rules_snapshot") = 'object')
);
--> statement-breakpoint
CREATE TABLE "round_commands" (
	"command_id" text PRIMARY KEY,
	"round_id" text NOT NULL,
	"actor_id" text,
	"service_id" text,
	"type" text NOT NULL,
	"payload_digest" text NOT NULL,
	"result" jsonb NOT NULL,
	"resulting_version" integer NOT NULL,
	"applied_at" timestamp with time zone NOT NULL,
	CONSTRAINT "round_commands_result_is_object" CHECK (jsonb_typeof("result") = 'object'),
	CONSTRAINT "round_commands_one_principal" CHECK (("actor_id" is null) <> ("service_id" is null)),
	CONSTRAINT "round_commands_digest_check" CHECK ("payload_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "round_commands_type_check" CHECK ("type" in ('start', 'start_prep', 'start_speech', 'yield', 'interrupt', 'forfeit', 'complete'))
);
--> statement-breakpoint
CREATE TABLE "round_participants" (
	"id" text PRIMARY KEY,
	"round_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"role" text NOT NULL,
	"slot" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "round_participants_role_check" CHECK ("role" in ('affirmative', 'negative', 'judge')),
	CONSTRAINT "round_participants_slot_check" CHECK ("slot" >= 0)
);
--> statement-breakpoint
CREATE TABLE "round_segments" (
	"id" text PRIMARY KEY,
	"round_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"type" text NOT NULL,
	"rules_segment_key" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"duration_ms" integer NOT NULL,
	CONSTRAINT "round_segments_type_check" CHECK ("type" in ('speech', 'cross_ex')),
	CONSTRAINT "round_segments_sequence_check" CHECK ("sequence" >= 0),
	CONSTRAINT "round_segments_duration_positive" CHECK ("duration_ms" > 0)
);
--> statement-breakpoint
CREATE TABLE "rounds" (
	"id" text PRIMARY KEY,
	"room_id" text,
	"created_by_actor_id" text,
	"resolution" text NOT NULL,
	"competition_type" text NOT NULL,
	"length" text NOT NULL,
	"format_id" text NOT NULL,
	"format_version" integer NOT NULL,
	"preset_version" integer,
	"rules_snapshot" jsonb NOT NULL,
	"status" text NOT NULL,
	"current_stage" text,
	"outcome" text,
	"ladder_id" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"runtime_state" jsonb DEFAULT '{"version":1,"prep_consumed_ms":{"affirmative":0,"negative":0},"active_prep":null,"floor":null}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "rounds_id_format_unique" UNIQUE("id","format_id"),
	CONSTRAINT "rounds_version_positive" CHECK ("version" > 0),
	CONSTRAINT "rounds_runtime_state_is_object" CHECK (jsonb_typeof("runtime_state") = 'object'),
	CONSTRAINT "rounds_completed_after_started" CHECK ("completed_at" is null or "completed_at" >= "started_at"),
	CONSTRAINT "rounds_status_check" CHECK ("status" in ('scheduled', 'active', 'completed', 'abandoned')),
	CONSTRAINT "rounds_current_stage_check" CHECK ("current_stage" is null or "current_stage" in ('countdown', 'prep', 'live')),
	CONSTRAINT "rounds_competition_type_check" CHECK ("competition_type" in ('ranked', 'casual', 'practice')),
	CONSTRAINT "rounds_length_check" CHECK ("length" in ('full', 'quick')),
	CONSTRAINT "rounds_outcome_check" CHECK ("outcome" is null or "outcome" in ('affirmative', 'negative', 'draw')),
	CONSTRAINT "rounds_ladder_check" CHECK ("ladder_id" is null or "ladder_id" in ('ranked', 'quick')),
	CONSTRAINT "rounds_lifecycle_check" CHECK (("status" = 'scheduled' and "current_stage" is null and "outcome" is null and "started_at" is null and "completed_at" is null) or ("status" = 'active' and "current_stage" is not null and "outcome" is null and "started_at" is not null and "completed_at" is null) or ("status" = 'completed' and "current_stage" is null and "outcome" is not null and "started_at" is not null and "completed_at" is not null) or ("status" = 'abandoned' and "current_stage" is null and "outcome" is null and "completed_at" is not null)),
	CONSTRAINT "rounds_rated_ladder_check" CHECK (("competition_type" = 'ranked' and "ladder_id" is not null) or ("competition_type" <> 'ranked' and "ladder_id" is null)),
	CONSTRAINT "rounds_ladder_derivation_check" CHECK ("ladder_id" = case
          when "competition_type" <> 'ranked' then null
          when "length" = 'full' then 'ranked'
          when "length" = 'quick' then 'quick' end),
	CONSTRAINT "rounds_ranked_has_preset_check" CHECK (("competition_type" = 'ranked') = ("preset_version" is not null))
);
--> statement-breakpoint
CREATE TABLE "seed_versions" (
	"seed_name" text PRIMARY KEY,
	"version" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_reservations" (
	"id" text PRIMARY KEY,
	"actor_id" text NOT NULL,
	"round_id" text NOT NULL,
	"kind" text NOT NULL,
	"counted_at" timestamp with time zone,
	CONSTRAINT "usage_reservations_kind_check" CHECK ("kind" in ('ai_practice'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY,
	"username" text,
	"email" text,
	"email_verified" boolean DEFAULT false NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_tombstone_scrubbed" CHECK ("deleted_at" is null or ("email" is null and "username" is null and "image" is null and "name" = '')),
	CONSTRAINT "users_version_positive" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE TABLE "utterances" (
	"id" text PRIMARY KEY,
	"round_id" text NOT NULL,
	"segment_id" text NOT NULL,
	"round_participant_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"text" text NOT NULL,
	"complete" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "utterances_sequence_check" CHECK ("sequence" >= 0),
	CONSTRAINT "utterances_text_length" CHECK (char_length("text") <= 20000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "actors_user_id_unique" ON "actors" ("user_id");--> statement-breakpoint
CREATE INDEX "agent_runs_participant_kind_idx" ON "agent_runs" ("round_participant_id","kind");--> statement-breakpoint
CREATE INDEX "agent_runs_started_idx" ON "agent_runs" ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "account_provider_account_unique" ON "account" ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "passkey_credential_id_unique" ON "passkey" ("credential_id");--> statement-breakpoint
CREATE INDEX "passkey_user_id_idx" ON "passkey" ("user_id");--> statement-breakpoint
CREATE INDEX "passkey_created_at_idx" ON "passkey" ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "session_token_unique" ON "session" ("token");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" ("user_id");--> statement-breakpoint
CREATE INDEX "session_expires_at_idx" ON "session" ("expires_at");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");--> statement-breakpoint
CREATE INDEX "verification_expires_at_idx" ON "verification" ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ballots_judge_seat_unique" ON "ballots" ("judge_participant_id");--> statement-breakpoint
CREATE INDEX "ballots_voided_by_actor_idx" ON "ballots" ("voided_by_actor_id");--> statement-breakpoint
CREATE INDEX "documents_owner_folder_idx" ON "documents" ("owner_actor_id","folder");--> statement-breakpoint
CREATE INDEX "documents_owner_created_idx" ON "documents" ("owner_actor_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "email_delivery_provider_message_unique" ON "email_delivery" ("provider_message_id");--> statement-breakpoint
CREATE INDEX "email_delivery_recipient_idx" ON "email_delivery" ("recipient_hash");--> statement-breakpoint
CREATE INDEX "email_delivery_updated_at_idx" ON "email_delivery" ("updated_at");--> statement-breakpoint
CREATE INDEX "email_delivery_event_received_idx" ON "email_delivery_event" ("received_at");--> statement-breakpoint
CREATE INDEX "email_delivery_event_provider_message_idx" ON "email_delivery_event" ("provider_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "format_presets_provenance_unique" ON "format_presets" ("format_id","length","version","format_version");--> statement-breakpoint
CREATE UNIQUE INDEX "format_presets_single_current" ON "format_presets" ("format_id","length") WHERE "superseded_at" is null;--> statement-breakpoint
CREATE INDEX "outbox_txid_seq_idx" ON "outbox" ("txid","seq");--> statement-breakpoint
CREATE INDEX "outbox_topic_idx" ON "outbox" ("topic");--> statement-breakpoint
CREATE INDEX "outbox_created_at_idx" ON "outbox" ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rating_changes_round_actor_unique" ON "rating_changes" ("round_id","actor_id");--> statement-breakpoint
CREATE INDEX "rating_changes_actor_format_occurred_idx" ON "rating_changes" ("actor_id","format_id","ladder","occurred_at");--> statement-breakpoint
CREATE INDEX "rating_changes_round_format_idx" ON "rating_changes" ("round_id","format_id");--> statement-breakpoint
CREATE INDEX "rating_changes_format_idx" ON "rating_changes" ("format_id");--> statement-breakpoint
CREATE INDEX "rating_changes_season_idx" ON "rating_changes" ("season_id");--> statement-breakpoint
CREATE INDEX "ratings_leaderboard_idx" ON "ratings" ("format_id","season_id","ladder","rating" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ratings_season_idx" ON "ratings" ("season_id");--> statement-breakpoint
CREATE UNIQUE INDEX "seasons_single_active" ON "seasons" ("status") WHERE "status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "role_grants_active_unique" ON "role_grants" ("user_id","role","scope_type",coalesce("scope_id", '')) WHERE "revoked_at" is null;--> statement-breakpoint
CREATE INDEX "role_grants_user_idx" ON "role_grants" ("user_id");--> statement-breakpoint
CREATE INDEX "role_grants_granted_by_user_idx" ON "role_grants" ("granted_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "room_participants_actor_unique" ON "room_participants" ("room_id","actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "room_participants_seat_unique" ON "room_participants" ("room_id","role","slot");--> statement-breakpoint
CREATE UNIQUE INDEX "rooms_single_preset_version" ON "rooms" ("format_id","length","preset_version","format_version");--> statement-breakpoint
CREATE INDEX "round_commands_round_version_idx" ON "round_commands" ("round_id","resulting_version");--> statement-breakpoint
CREATE INDEX "round_commands_actor_idx" ON "round_commands" ("actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "round_participants_actor_unique" ON "round_participants" ("round_id","actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "round_participants_seat_unique" ON "round_participants" ("round_id","role","slot");--> statement-breakpoint
CREATE UNIQUE INDEX "round_participants_id_round_unique" ON "round_participants" ("id","round_id");--> statement-breakpoint
CREATE INDEX "round_participants_actor_idx" ON "round_participants" ("actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "round_segments_sequence_unique" ON "round_segments" ("round_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "round_segments_key_unique" ON "round_segments" ("round_id","rules_segment_key");--> statement-breakpoint
CREATE UNIQUE INDEX "round_segments_id_round_unique" ON "round_segments" ("id","round_id");--> statement-breakpoint
CREATE UNIQUE INDEX "round_segments_single_open" ON "round_segments" ("round_id") WHERE "ended_at" is null;--> statement-breakpoint
CREATE INDEX "round_segments_started_idx" ON "round_segments" ("started_at");--> statement-breakpoint
CREATE INDEX "rounds_status_competition_created_idx" ON "rounds" ("status","competition_type","created_at");--> statement-breakpoint
CREATE INDEX "rounds_format_completed_idx" ON "rounds" ("format_id","completed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_reservations_actor_round_kind_unique" ON "usage_reservations" ("actor_id","round_id","kind");--> statement-breakpoint
CREATE INDEX "usage_reservations_counted_idx" ON "usage_reservations" ("counted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_lower_unique" ON "users" (lower("username"));--> statement-breakpoint
CREATE UNIQUE INDEX "utterances_segment_sequence_unique" ON "utterances" ("segment_id","sequence");--> statement-breakpoint
CREATE INDEX "utterances_participant_idx" ON "utterances" ("round_participant_id");--> statement-breakpoint
ALTER TABLE "actors" ADD CONSTRAINT "actors_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_round_participant_id_round_participants_id_fkey" FOREIGN KEY ("round_participant_id") REFERENCES "round_participants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ballots" ADD CONSTRAINT "ballots_judge_seat_fk" FOREIGN KEY ("judge_participant_id") REFERENCES "round_participants"("id");--> statement-breakpoint
ALTER TABLE "ballots" ADD CONSTRAINT "ballots_voided_by_actor_fk" FOREIGN KEY ("voided_by_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "bot_profiles" ADD CONSTRAINT "bot_profiles_actor_id_actors_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_actor_id_actors_id_fkey" FOREIGN KEY ("owner_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "round_document_refs" ADD CONSTRAINT "round_document_refs_round_fk" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "round_document_refs" ADD CONSTRAINT "round_document_refs_document_fk" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "format_presets" ADD CONSTRAINT "format_presets_revision_fk" FOREIGN KEY ("format_id","format_version") REFERENCES "format_revisions"("format_id","version");--> statement-breakpoint
ALTER TABLE "formats" ADD CONSTRAINT "formats_current_revision_fk" FOREIGN KEY ("id","current_version") REFERENCES "format_revisions"("format_id","version") DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "member_interests" ADD CONSTRAINT "member_interests_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "member_onboarding" ADD CONSTRAINT "member_onboarding_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "member_topics" ADD CONSTRAINT "member_topics_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "rating_changes" ADD CONSTRAINT "rating_changes_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "rating_changes" ADD CONSTRAINT "rating_changes_actor_id_actors_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "rating_changes" ADD CONSTRAINT "rating_changes_format_id_formats_id_fkey" FOREIGN KEY ("format_id") REFERENCES "formats"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "rating_changes" ADD CONSTRAINT "rating_changes_season_id_seasons_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "rating_changes" ADD CONSTRAINT "rating_changes_participant_fk" FOREIGN KEY ("round_id","actor_id") REFERENCES "round_participants"("round_id","actor_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "rating_changes" ADD CONSTRAINT "rating_changes_round_format_fk" FOREIGN KEY ("round_id","format_id") REFERENCES "rounds"("id","format_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_actor_id_actors_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_format_id_formats_id_fkey" FOREIGN KEY ("format_id") REFERENCES "formats"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_season_id_seasons_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "role_grants" ADD CONSTRAINT "role_grants_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "role_grants" ADD CONSTRAINT "role_grants_granted_by_user_id_users_id_fkey" FOREIGN KEY ("granted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "room_participants" ADD CONSTRAINT "room_participants_room_id_rooms_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "room_participants" ADD CONSTRAINT "room_participants_actor_id_actors_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_format_id_formats_id_fkey" FOREIGN KEY ("format_id") REFERENCES "formats"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_definition_revision_fk" FOREIGN KEY ("format_id","format_version") REFERENCES "format_revisions"("format_id","version");--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_preset_provenance_fk" FOREIGN KEY ("format_id","length","preset_version","format_version") REFERENCES "format_presets"("format_id","length","version","format_version");--> statement-breakpoint
ALTER TABLE "round_commands" ADD CONSTRAINT "round_commands_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "round_commands" ADD CONSTRAINT "round_commands_actor_id_actors_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "round_participants" ADD CONSTRAINT "round_participants_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "round_participants" ADD CONSTRAINT "round_participants_actor_id_actors_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "round_segments" ADD CONSTRAINT "round_segments_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_room_id_rooms_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_created_by_actor_id_actors_id_fkey" FOREIGN KEY ("created_by_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_format_id_formats_id_fkey" FOREIGN KEY ("format_id") REFERENCES "formats"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_definition_revision_fk" FOREIGN KEY ("format_id","format_version") REFERENCES "format_revisions"("format_id","version");--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_preset_provenance_fk" FOREIGN KEY ("format_id","length","preset_version","format_version") REFERENCES "format_presets"("format_id","length","version","format_version");--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD CONSTRAINT "usage_reservations_actor_id_actors_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD CONSTRAINT "usage_reservations_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "utterances" ADD CONSTRAINT "utterances_segment_round_fk" FOREIGN KEY ("segment_id","round_id") REFERENCES "round_segments"("id","round_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "utterances" ADD CONSTRAINT "utterances_participant_round_fk" FOREIGN KEY ("round_participant_id","round_id") REFERENCES "round_participants"("id","round_id") ON DELETE RESTRICT;

--> Baseline integrity, folded rather than shipped as a forward step: the
--> squash has not reached the default branch and Daisy has no deployed
--> consumers (ADR 0023), so a second step over an unshipped baseline is
--> exactly the compat history this repository refuses to accrete.
ALTER TABLE "ballots" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
CREATE INDEX "round_document_refs_document_idx" ON "round_document_refs" ("document_id");
CREATE INDEX "format_presets_revision_idx" ON "format_presets" ("format_id","format_version");
CREATE INDEX "formats_current_revision_idx" ON "formats" ("id","current_version");
CREATE INDEX "room_participants_actor_idx" ON "room_participants" ("actor_id");
CREATE INDEX "rooms_definition_revision_idx" ON "rooms" ("format_id","format_version");
CREATE INDEX "rounds_room_idx" ON "rounds" ("room_id");
CREATE INDEX "rounds_created_by_actor_idx" ON "rounds" ("created_by_actor_id");
CREATE INDEX "rounds_definition_revision_idx" ON "rounds" ("format_id","format_version");
CREATE INDEX "rounds_preset_provenance_idx" ON "rounds" ("format_id","length","preset_version","format_version");
CREATE INDEX "usage_reservations_round_idx" ON "usage_reservations" ("round_id");
CREATE INDEX "utterances_segment_round_idx" ON "utterances" ("segment_id","round_id");
CREATE INDEX "utterances_participant_round_idx" ON "utterances" ("round_participant_id","round_id");
ALTER TABLE "ballots" ADD CONSTRAINT "ballots_feedback_is_object" CHECK (jsonb_typeof("feedback") = 'object');
ALTER TABLE "ballots" ADD CONSTRAINT "ballots_citations_is_object" CHECK (jsonb_typeof("citations") = 'object');
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_rules_snapshot_is_object" CHECK (jsonb_typeof("rules_snapshot") = 'object');

--> statement-breakpoint
--> Reference data ships in migrations, never in the seed (ADR 0038).
--> The rows mirror scripts/reference-formats.ts; the sync test fails when
--> they drift.
INSERT INTO "format_revisions" ("format_id", "version", "definition", "created_at") VALUES
  ('one-on-one', 1, '{"version":1,"seats":{"affirmative":1,"negative":1,"judge":1},"segments":[{"key":"AC","label":"Affirmative constructive","type":"speech","side":"affirmative","slot":0,"defaultDurationMs":300000},{"key":"CX1","label":"Cross-examination of the affirmative","type":"cross_ex","side":"negative","slot":0,"defaultDurationMs":120000},{"key":"NC","label":"Negative constructive","type":"speech","side":"negative","slot":0,"defaultDurationMs":360000},{"key":"CX2","label":"Cross-examination of the negative","type":"cross_ex","side":"affirmative","slot":0,"defaultDurationMs":120000},{"key":"1AR","label":"First affirmative rebuttal","type":"speech","side":"affirmative","slot":0,"defaultDurationMs":300000},{"key":"NR","label":"Negative rebuttal","type":"speech","side":"negative","slot":0,"defaultDurationMs":300000},{"key":"2AR","label":"Second affirmative rebuttal","type":"speech","side":"affirmative","slot":0,"defaultDurationMs":180000}],"configurable":{"timing":{"segmentDurationMs":{"AC":{"min":60000,"max":600000},"CX1":{"min":30000,"max":300000},"NC":{"min":60000,"max":600000},"CX2":{"min":30000,"max":300000},"1AR":{"min":60000,"max":600000},"NR":{"min":60000,"max":600000},"2AR":{"min":30000,"max":600000}},"countdownMs":{"min":0,"max":60000}},"inRoundPrep":{"budgetMsPerSide":{"min":0,"max":600000},"spendableBefore":["speech"],"expiresAtSegment":null},"preRoundPrep":{"durationMs":{"min":0,"max":1200000}},"interaction":{"crossExModes":["ordered","free"],"interruptions":{"modes":["disabled","cross_ex_only","enabled"],"minRemainingMs":{"min":0,"max":300000}},"yield":{"enabledChoices":[true,false],"returnsTimeChoices":[true,false]}}}}'::jsonb, statement_timestamp()),
  ('foundation', 1, '{"version":1,"seats":{"affirmative":1,"negative":1,"judge":0},"segments":[{"key":"AC","label":"Affirmative constructive","type":"speech","side":"affirmative","slot":0,"defaultDurationMs":240000},{"key":"NC","label":"Negative constructive","type":"speech","side":"negative","slot":0,"defaultDurationMs":240000}],"configurable":{"timing":{"segmentDurationMs":{"AC":{"min":60000,"max":600000},"NC":{"min":60000,"max":600000}},"countdownMs":{"min":0,"max":60000}},"inRoundPrep":{"budgetMsPerSide":{"min":0,"max":600000},"spendableBefore":["speech"],"expiresAtSegment":null},"preRoundPrep":null,"interaction":{"crossExModes":["ordered"],"interruptions":null,"yield":null}}}'::jsonb, statement_timestamp());
INSERT INTO "formats" ("id", "name", "current_version", "created_at", "updated_at") VALUES
  ('one-on-one', 'One-on-one', 1, statement_timestamp(), statement_timestamp()),
  ('foundation', 'Foundation (architectural proof)', 1, statement_timestamp(), statement_timestamp());
INSERT INTO "format_presets" ("format_id", "length", "version", "format_version", "config", "approved_at") VALUES
  ('one-on-one', 'full', 1, 1, '{"preRoundPrep":{"enabled":true,"durationMs":1200000},"inRoundPrep":{"enabled":true,"budgetMsPerSide":240000},"speechTiming":{"countdownMs":10000,"segmentDurationOverrides":{}},"crossExamination":{"crossExMode":"ordered"},"interruptions":{"mode":"cross_ex_only","minRemainingMs":30000},"yielding":{"allowed":true,"returnsTime":true}}'::jsonb, statement_timestamp()),
  ('one-on-one', 'quick', 1, 1, '{"preRoundPrep":{"enabled":true,"durationMs":1200000},"inRoundPrep":{"enabled":true,"budgetMsPerSide":120000},"speechTiming":{"countdownMs":10000,"segmentDurationOverrides":{"AC":150000,"CX1":60000,"NC":180000,"CX2":60000,"1AR":150000,"NR":150000,"2AR":90000}},"crossExamination":{"crossExMode":"ordered"},"interruptions":{"mode":"cross_ex_only","minRemainingMs":30000},"yielding":{"allowed":true,"returnsTime":true}}'::jsonb, statement_timestamp());
--> Bot actors and the AI judge: participant implementations, seeded as
--> reference rows alongside the formats they face.
INSERT INTO "actors" ("id", "kind", "created_at", "updated_at", "version") VALUES
  ('j9u2n6o1b4r8o2s5a9c1d3e7', 'bot', statement_timestamp(), statement_timestamp(), 1),
  ('w2r5e8n1b4o7t0a3n6i9c2e5', 'bot', statement_timestamp(), statement_timestamp(), 1),
  ('b1r4a7m0b3r6a9n2c5h8e1s4', 'bot', statement_timestamp(), statement_timestamp(), 1),
  ('a1i2j3u4d5g6e7a8i9j0u1d2', 'bot', statement_timestamp(), statement_timestamp(), 1);
INSERT INTO "bot_profiles" ("actor_id", "name", "persona", "voice", "difficulty") VALUES
  ('j9u2n6o1b4r8o2s5a9c1d3e7', 'Juno', 'Wears every feeling on its sleeve, tells long stories, and cannot help being enthusiastic about almost anything.', 'aura-2-aurora-en', 'beginner'),
  ('w2r5e8n1b4o7t0a3n6i9c2e5', 'Wren', 'Sarcastic in a friendly way, always has a comeback, and is never quite as unimpressed as it sounds.', 'aura-2-thalia-en', 'intermediate'),
  ('b1r4a7m0b3r6a9n2c5h8e1s4', 'Bram', 'Steady and methodical, prefers structure over flourishes, and answers exactly what was asked.', 'aura-2-arcas-en', 'advanced'),
  ('a1i2j3u4d5g6e7a8i9j0u1d2', 'The Panel', 'A careful judge that rules only on what the round said.', 'aura-2-thalia-en', 'advanced');
--> statement-breakpoint
--> Runtime roles, their grants and the reference data above: none of it
--> drizzle-kit generates. Roles are cluster-wide and every local slot shares
--> one cluster, so each is created only if missing. No password is set:
--> production provisions runtime credentials out of band
--> (docs/operations/database.md), and the migration credential needs
--> CREATEROLE.
-->
--> daisy_web: the web application's runtime role. DML on every table and
--> use of every sequence (a bigserial default calls nextval()), nothing that
--> alters schema: no CREATE on public, no TRUNCATE, REFERENCES or TRIGGER,
--> and no access to the drizzle migrations schema. Default privileges extend
--> the same grants to tables and sequences later migrations create.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'daisy_web') THEN
    CREATE ROLE daisy_web LOGIN;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO daisy_web;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO daisy_web;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO daisy_web;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO daisy_web;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO daisy_web;
--> statement-breakpoint
--> daisy_realtime: the realtime service's only credential (ADR 0032 §7).
--> SELECT on the outbox delivery log and the competitive read models;
--> `actors` and `session` are column-scoped and `users` gets no grant (identity
--> resolves through actors.user_id, which carries no PII; never `token`, the
--> bearer credential). Explicit grants only: default privileges never reach
--> it, so a new table stays invisible to realtime until a migration grants it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'daisy_realtime') THEN
    CREATE ROLE daisy_realtime LOGIN;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO daisy_realtime;
--> statement-breakpoint
GRANT SELECT ON outbox, rounds, round_participants TO daisy_realtime;
--> statement-breakpoint
GRANT SELECT (id, user_id) ON actors TO daisy_realtime;
--> statement-breakpoint
GRANT SELECT (id, user_id, expires_at) ON session TO daisy_realtime;
