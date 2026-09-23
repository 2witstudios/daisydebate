CREATE TABLE "actors" (
	"id" text PRIMARY KEY,
	"kind" text NOT NULL,
	"user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "actors_kind_check" CHECK ("kind" in ('human')),
	CONSTRAINT "actors_human_has_user" CHECK ("kind" <> 'human' or "user_id" is not null),
	CONSTRAINT "actors_version_positive" CHECK ("version" > 0)
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
	"debate_id" text NOT NULL,
	"judge_actor_id" text NOT NULL,
	"decision" text NOT NULL,
	"scores" jsonb NOT NULL,
	"reason" text NOT NULL,
	"status" text NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by_actor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "ballots_decision_check" CHECK ("decision" in ('affirmative', 'negative', 'draw')),
	CONSTRAINT "ballots_status_check" CHECK ("status" in ('submitted', 'voided')),
	CONSTRAINT "ballots_voided_fields_check" CHECK (("status" = 'voided' and "voided_at" is not null and "voided_by_actor_id" is not null) or ("status" <> 'voided' and "voided_at" is null and "voided_by_actor_id" is null)),
	CONSTRAINT "ballots_voided_after_submitted" CHECK ("voided_at" is null or "voided_at" >= "submitted_at"),
	CONSTRAINT "ballots_scores_is_object" CHECK (jsonb_typeof("scores") = 'object'),
	CONSTRAINT "ballots_version_positive" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE TABLE "debate_commands" (
	"command_id" text PRIMARY KEY,
	"debate_id" text NOT NULL,
	"actor_id" text,
	"service_id" text,
	"type" text NOT NULL,
	"payload_digest" text NOT NULL,
	"result" jsonb NOT NULL,
	"resulting_version" integer NOT NULL,
	"applied_at" timestamp with time zone NOT NULL,
	CONSTRAINT "debate_commands_result_is_object" CHECK (jsonb_typeof("result") = 'object'),
	CONSTRAINT "debate_commands_one_principal" CHECK (("actor_id" is null) <> ("service_id" is null)),
	CONSTRAINT "debate_commands_digest_check" CHECK ("payload_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "debate_participants" (
	"debate_id" text,
	"actor_id" text,
	"role" text NOT NULL,
	"slot" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"joined_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "debate_participants_pkey" PRIMARY KEY("debate_id","actor_id"),
	CONSTRAINT "debate_participants_role_check" CHECK ("role" in ('affirmative', 'negative', 'judge')),
	CONSTRAINT "debate_participants_slot_check" CHECK ("slot" >= 0),
	CONSTRAINT "debate_participants_status_check" CHECK ("status" in ('joined', 'ready')),
	CONSTRAINT "debate_participants_version_positive" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE TABLE "debates" (
	"id" text PRIMARY KEY,
	"created_by_actor_id" text,
	"resolution" text NOT NULL,
	"format_id" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"mode" text NOT NULL,
	"phase" text NOT NULL,
	"visibility" text NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"outcome" text,
	CONSTRAINT "debates_id_format_unique" UNIQUE("id","format_id"),
	CONSTRAINT "debates_version_positive" CHECK ("version" > 0),
	CONSTRAINT "debates_snapshot_is_object" CHECK (jsonb_typeof("snapshot") = 'object'),
	CONSTRAINT "debates_completed_after_started" CHECK ("completed_at" is null or "completed_at" >= "started_at"),
	CONSTRAINT "debates_mode_check" CHECK ("mode" in ('casual', 'ranked', 'practice')),
	CONSTRAINT "debates_phase_check" CHECK ("phase" in ('waiting', 'active', 'completed')),
	CONSTRAINT "debates_visibility_check" CHECK ("visibility" in ('public', 'unlisted', 'private')),
	CONSTRAINT "debates_outcome_check" CHECK ("outcome" is null or "outcome" in ('affirmative', 'negative', 'draw', 'abandoned')),
	CONSTRAINT "debates_lifecycle_check" CHECK (("phase" = 'waiting' and "started_at" is null and "completed_at" is null and "outcome" is null) or ("phase" = 'active' and "started_at" is not null and "completed_at" is null and "outcome" is null) or ("phase" = 'completed' and "completed_at" is not null and "outcome" is not null and ("started_at" is not null or "outcome" = 'abandoned')))
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
CREATE TABLE "formats" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"rules" jsonb NOT NULL,
	"ranked_eligible" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "formats_rules_is_object" CHECK (jsonb_typeof("rules") = 'object'),
	CONSTRAINT "formats_rules_shape" CHECK (coalesce("rules"->>'version', '') = '1' and coalesce(jsonb_typeof("rules"->'seats'), '') = 'object' and coalesce(jsonb_typeof("rules"->'clock'), '') = 'object'),
	CONSTRAINT "formats_version_positive" CHECK ("version" > 0)
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
	"debate_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"format_id" text NOT NULL,
	"season_id" text NOT NULL,
	"rating_before" double precision NOT NULL,
	"rating_after" double precision NOT NULL,
	"deviation_before" double precision NOT NULL,
	"deviation_after" double precision NOT NULL,
	"volatility_before" double precision NOT NULL,
	"volatility_after" double precision NOT NULL,
	"calculation_version" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "rating_changes_rating_range" CHECK ("rating_before" between 0 and 4000 and "rating_after" between 0 and 4000),
	CONSTRAINT "rating_changes_deviation_positive" CHECK ("deviation_before" > 0 and "deviation_before" < 'infinity'::double precision and "deviation_after" > 0 and "deviation_after" < 'infinity'::double precision),
	CONSTRAINT "rating_changes_volatility_positive" CHECK ("volatility_before" > 0 and "volatility_before" < 'infinity'::double precision and "volatility_after" > 0 and "volatility_after" < 'infinity'::double precision)
);
--> statement-breakpoint
CREATE TABLE "ratings" (
	"actor_id" text,
	"format_id" text,
	"season_id" text,
	"rating" double precision NOT NULL,
	"deviation" double precision NOT NULL,
	"volatility" double precision NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "ratings_pkey" PRIMARY KEY("actor_id","format_id","season_id"),
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
	CONSTRAINT "role_grants_role_check" CHECK ("role" in ('admin', 'moderator', 'judge')),
	CONSTRAINT "role_grants_scope_type_check" CHECK ("scope_type" in ('global')),
	CONSTRAINT "role_grants_global_scope_check" CHECK ("scope_type" <> 'global' or "scope_id" is null),
	CONSTRAINT "role_grants_revoked_after_granted" CHECK ("revoked_at" is null or "revoked_at" >= "granted_at")
);
--> statement-breakpoint
CREATE TABLE "seed_versions" (
	"seed_name" text PRIMARY KEY,
	"version" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
CREATE UNIQUE INDEX "actors_user_id_unique" ON "actors" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_provider_account_unique" ON "account" ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "passkey_credential_id_unique" ON "passkey" ("credential_id");--> statement-breakpoint
CREATE INDEX "passkey_user_id_idx" ON "passkey" ("user_id");--> statement-breakpoint
CREATE INDEX "passkey_created_at_idx" ON "passkey" ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "session_token_unique" ON "session" ("token");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");--> statement-breakpoint
CREATE INDEX "verification_expires_at_idx" ON "verification" ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ballots_judge_seat_unique" ON "ballots" ("debate_id","judge_actor_id");--> statement-breakpoint
CREATE INDEX "ballots_voided_by_actor_idx" ON "ballots" ("voided_by_actor_id");--> statement-breakpoint
CREATE INDEX "debate_commands_debate_version_idx" ON "debate_commands" ("debate_id","resulting_version");--> statement-breakpoint
CREATE INDEX "debate_commands_actor_idx" ON "debate_commands" ("actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "debate_participants_seat_unique" ON "debate_participants" ("debate_id","role","slot");--> statement-breakpoint
CREATE INDEX "debate_participants_actor_joined_idx" ON "debate_participants" ("actor_id","joined_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "debates_created_by_actor_idx" ON "debates" ("created_by_actor_id");--> statement-breakpoint
CREATE INDEX "debates_phase_mode_created_idx" ON "debates" ("phase","mode","created_at");--> statement-breakpoint
CREATE INDEX "debates_format_completed_idx" ON "debates" ("format_id","completed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "email_delivery_provider_message_unique" ON "email_delivery" ("provider_message_id");--> statement-breakpoint
CREATE INDEX "email_delivery_recipient_idx" ON "email_delivery" ("recipient_hash");--> statement-breakpoint
CREATE INDEX "email_delivery_event_received_idx" ON "email_delivery_event" ("received_at");--> statement-breakpoint
CREATE INDEX "email_delivery_event_provider_message_idx" ON "email_delivery_event" ("provider_message_id");--> statement-breakpoint
CREATE INDEX "outbox_txid_seq_idx" ON "outbox" ("txid","seq");--> statement-breakpoint
CREATE INDEX "outbox_topic_idx" ON "outbox" ("topic");--> statement-breakpoint
CREATE INDEX "outbox_created_at_idx" ON "outbox" ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rating_changes_debate_actor_unique" ON "rating_changes" ("debate_id","actor_id");--> statement-breakpoint
CREATE INDEX "rating_changes_actor_format_occurred_idx" ON "rating_changes" ("actor_id","format_id","occurred_at");--> statement-breakpoint
CREATE INDEX "rating_changes_debate_format_idx" ON "rating_changes" ("debate_id","format_id");--> statement-breakpoint
CREATE INDEX "rating_changes_format_idx" ON "rating_changes" ("format_id");--> statement-breakpoint
CREATE INDEX "rating_changes_season_idx" ON "rating_changes" ("season_id");--> statement-breakpoint
CREATE INDEX "ratings_leaderboard_idx" ON "ratings" ("format_id","season_id","rating" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ratings_season_idx" ON "ratings" ("season_id");--> statement-breakpoint
CREATE UNIQUE INDEX "seasons_single_active" ON "seasons" ("status") WHERE "status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "role_grants_active_unique" ON "role_grants" ("user_id","role","scope_type",coalesce("scope_id", '')) WHERE "revoked_at" is null;--> statement-breakpoint
CREATE INDEX "role_grants_user_idx" ON "role_grants" ("user_id");--> statement-breakpoint
CREATE INDEX "role_grants_granted_by_user_idx" ON "role_grants" ("granted_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_lower_unique" ON "users" (lower("username"));--> statement-breakpoint
ALTER TABLE "actors" ADD CONSTRAINT "actors_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ballots" ADD CONSTRAINT "ballots_debate_id_debates_id_fkey" FOREIGN KEY ("debate_id") REFERENCES "debates"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ballots" ADD CONSTRAINT "ballots_voided_by_actor_id_actors_id_fkey" FOREIGN KEY ("voided_by_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "ballots" ADD CONSTRAINT "ballots_judge_seat_fk" FOREIGN KEY ("debate_id","judge_actor_id") REFERENCES "debate_participants"("debate_id","actor_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "debate_commands" ADD CONSTRAINT "debate_commands_debate_id_debates_id_fkey" FOREIGN KEY ("debate_id") REFERENCES "debates"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "debate_commands" ADD CONSTRAINT "debate_commands_actor_id_actors_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "debate_participants" ADD CONSTRAINT "debate_participants_debate_id_debates_id_fkey" FOREIGN KEY ("debate_id") REFERENCES "debates"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "debate_participants" ADD CONSTRAINT "debate_participants_actor_id_actors_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "debates" ADD CONSTRAINT "debates_created_by_actor_id_actors_id_fkey" FOREIGN KEY ("created_by_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "debates" ADD CONSTRAINT "debates_format_id_formats_id_fkey" FOREIGN KEY ("format_id") REFERENCES "formats"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "rating_changes" ADD CONSTRAINT "rating_changes_debate_id_debates_id_fkey" FOREIGN KEY ("debate_id") REFERENCES "debates"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "rating_changes" ADD CONSTRAINT "rating_changes_actor_id_actors_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "rating_changes" ADD CONSTRAINT "rating_changes_format_id_formats_id_fkey" FOREIGN KEY ("format_id") REFERENCES "formats"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "rating_changes" ADD CONSTRAINT "rating_changes_season_id_seasons_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "rating_changes" ADD CONSTRAINT "rating_changes_participant_fk" FOREIGN KEY ("debate_id","actor_id") REFERENCES "debate_participants"("debate_id","actor_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "rating_changes" ADD CONSTRAINT "rating_changes_debate_format_fk" FOREIGN KEY ("debate_id","format_id") REFERENCES "debates"("id","format_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_actor_id_actors_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_format_id_formats_id_fkey" FOREIGN KEY ("format_id") REFERENCES "formats"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_season_id_seasons_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "role_grants" ADD CONSTRAINT "role_grants_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "role_grants" ADD CONSTRAINT "role_grants_granted_by_user_id_users_id_fkey" FOREIGN KEY ("granted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
-- Everything below is written by hand and reviewed (ADR 0038): runtime
-- roles, their grants and reference data, none of which drizzle-kit
-- generates. Roles are cluster-wide and every local slot shares one
-- cluster, so each is created only if missing. No password is set:
-- production provisions runtime credentials out of band
-- (docs/operations/database.md), and the migration credential needs
-- CREATEROLE.
--
-- daisy_web: the web application's runtime role. DML on every table and
-- use of every sequence (a bigserial default calls nextval()), nothing that
-- alters schema: no CREATE on public, no TRUNCATE, REFERENCES or TRIGGER,
-- and no access to the drizzle migrations schema. Default privileges extend
-- the same grants to tables and sequences later migrations create.
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
-- daisy_realtime: the realtime service's only credential (ADR 0032 §7).
-- SELECT on the outbox delivery log and the authorization read models;
-- `actors` and `session` are column-scoped and `users` gets no grant (identity
-- resolves through actors.user_id, which carries no PII; never `token`, the
-- bearer credential). Explicit grants only: default privileges never reach
-- it, so a new table stays invisible to realtime until a migration grants
-- it (RT-3.2b adds one users column; RT-4.3a adds
-- INSERT, UPDATE ON service_instances).
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
GRANT SELECT ON outbox, debates, debate_participants TO daisy_realtime;
--> statement-breakpoint
GRANT SELECT (id, user_id) ON actors TO daisy_realtime;
--> statement-breakpoint
GRANT SELECT (id, user_id, expires_at) ON session TO daisy_realtime;
--> statement-breakpoint
-- Reference data every environment needs (ADR 0029, ADR 0038): debates
-- reference formats, so the foundation format ships with the schema, never
-- with the dev seed. Later reference rows arrive in forward migrations.
INSERT INTO "formats" ("id", "name", "rules", "ranked_eligible")
VALUES ('foundation', 'Foundation (architectural proof)', '{"version":1,"seats":{"affirmative":1,"negative":1,"judge":0},"clock":{"speechMs":240000,"prepMs":120000}}'::jsonb, false);
