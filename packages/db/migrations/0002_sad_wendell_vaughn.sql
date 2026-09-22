CREATE TABLE "actors" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "actors_kind_check" CHECK ("actors"."kind" in ('human')),
	CONSTRAINT "actors_human_has_user" CHECK ("actors"."kind" <> 'human' or "actors"."user_id" is not null),
	CONSTRAINT "actors_version_positive" CHECK ("actors"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "ballots" (
	"id" text PRIMARY KEY NOT NULL,
	"debate_id" text NOT NULL,
	"participant_id" text NOT NULL,
	"decision" text NOT NULL,
	"scores" jsonb NOT NULL,
	"reason" text NOT NULL,
	"status" text NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by_actor_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "ballots_decision_check" CHECK ("ballots"."decision" in ('affirmative', 'negative', 'draw')),
	CONSTRAINT "ballots_status_check" CHECK ("ballots"."status" in ('submitted', 'voided')),
	CONSTRAINT "ballots_voided_fields_check" CHECK (("ballots"."status" = 'voided' and "ballots"."voided_at" is not null and "ballots"."voided_by_actor_id" is not null) or ("ballots"."status" <> 'voided' and "ballots"."voided_at" is null and "ballots"."voided_by_actor_id" is null)),
	CONSTRAINT "ballots_version_positive" CHECK ("ballots"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "debate_commands" (
	"command_id" text PRIMARY KEY NOT NULL,
	"debate_id" text NOT NULL,
	"actor_id" text,
	"service_id" text,
	"type" text NOT NULL,
	"payload_digest" text NOT NULL,
	"result" jsonb NOT NULL,
	"resulting_version" integer NOT NULL,
	"applied_at" timestamp with time zone NOT NULL,
	CONSTRAINT "debate_commands_one_principal" CHECK (("debate_commands"."actor_id" is null) <> ("debate_commands"."service_id" is null)),
	CONSTRAINT "debate_commands_digest_check" CHECK ("debate_commands"."payload_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "debate_participants" (
	"id" text PRIMARY KEY NOT NULL,
	"debate_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"role" text NOT NULL,
	"slot" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"joined_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "debate_participants_role_check" CHECK ("debate_participants"."role" in ('affirmative', 'negative', 'judge')),
	CONSTRAINT "debate_participants_slot_check" CHECK ("debate_participants"."slot" >= 0),
	CONSTRAINT "debate_participants_status_check" CHECK ("debate_participants"."status" in ('joined', 'ready', 'declined', 'removed')),
	CONSTRAINT "debate_participants_version_positive" CHECK ("debate_participants"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "formats" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"rules" jsonb NOT NULL,
	"ranked_eligible" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "formats_version_positive" CHECK ("formats"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "rating_changes" (
	"id" text PRIMARY KEY NOT NULL,
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
	CONSTRAINT "rating_changes_rating_range" CHECK ("rating_changes"."rating_before" between 0 and 4000 and "rating_changes"."rating_after" between 0 and 4000),
	CONSTRAINT "rating_changes_deviation_positive" CHECK ("rating_changes"."deviation_before" > 0 and "rating_changes"."deviation_after" > 0),
	CONSTRAINT "rating_changes_volatility_positive" CHECK ("rating_changes"."volatility_before" > 0 and "rating_changes"."volatility_after" > 0)
);
--> statement-breakpoint
CREATE TABLE "ratings" (
	"actor_id" text NOT NULL,
	"format_id" text NOT NULL,
	"season_id" text NOT NULL,
	"rating" double precision NOT NULL,
	"deviation" double precision NOT NULL,
	"volatility" double precision NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "ratings_actor_id_format_id_season_id_pk" PRIMARY KEY("actor_id","format_id","season_id"),
	CONSTRAINT "ratings_rating_range" CHECK ("ratings"."rating" between 0 and 4000),
	CONSTRAINT "ratings_deviation_positive" CHECK ("ratings"."deviation" > 0),
	CONSTRAINT "ratings_volatility_positive" CHECK ("ratings"."volatility" > 0),
	CONSTRAINT "ratings_version_positive" CHECK ("ratings"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "seasons_status_check" CHECK ("seasons"."status" in ('scheduled', 'active', 'closed')),
	CONSTRAINT "seasons_version_positive" CHECK ("seasons"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "role_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" text,
	"granted_by_user_id" text,
	"granted_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "role_grants_role_check" CHECK ("role_grants"."role" in ('admin', 'moderator', 'judge')),
	CONSTRAINT "role_grants_scope_type_check" CHECK ("role_grants"."scope_type" in ('global')),
	CONSTRAINT "role_grants_global_scope_check" CHECK ("role_grants"."scope_type" <> 'global' or "role_grants"."scope_id" is null)
);
--> statement-breakpoint
-- ADR 0029 / ADR 0023: pre-ship, the only debates are proof-route rows whose
-- created_by is a users id. cuid2 cannot be minted in SQL, so there is no
-- backfill into actors: the rows are dropped before created_by is re-pointed
-- and the NOT NULL lifecycle columns are added.
TRUNCATE TABLE "debates";--> statement-breakpoint
ALTER TABLE "debates" DROP CONSTRAINT "debates_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "debates" ADD COLUMN "mode" text NOT NULL;--> statement-breakpoint
ALTER TABLE "debates" ADD COLUMN "phase" text NOT NULL;--> statement-breakpoint
ALTER TABLE "debates" ADD COLUMN "visibility" text NOT NULL;--> statement-breakpoint
ALTER TABLE "debates" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "debates" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "debates" ADD COLUMN "outcome" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "actors" ADD CONSTRAINT "actors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ballots" ADD CONSTRAINT "ballots_debate_id_debates_id_fk" FOREIGN KEY ("debate_id") REFERENCES "public"."debates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ballots" ADD CONSTRAINT "ballots_participant_id_debate_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."debate_participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ballots" ADD CONSTRAINT "ballots_voided_by_actor_id_actors_id_fk" FOREIGN KEY ("voided_by_actor_id") REFERENCES "public"."actors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debate_commands" ADD CONSTRAINT "debate_commands_debate_id_debates_id_fk" FOREIGN KEY ("debate_id") REFERENCES "public"."debates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debate_commands" ADD CONSTRAINT "debate_commands_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debate_participants" ADD CONSTRAINT "debate_participants_debate_id_debates_id_fk" FOREIGN KEY ("debate_id") REFERENCES "public"."debates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debate_participants" ADD CONSTRAINT "debate_participants_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_changes" ADD CONSTRAINT "rating_changes_debate_id_debates_id_fk" FOREIGN KEY ("debate_id") REFERENCES "public"."debates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_changes" ADD CONSTRAINT "rating_changes_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_changes" ADD CONSTRAINT "rating_changes_format_id_formats_id_fk" FOREIGN KEY ("format_id") REFERENCES "public"."formats"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_changes" ADD CONSTRAINT "rating_changes_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_actor_id_actors_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."actors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_format_id_formats_id_fk" FOREIGN KEY ("format_id") REFERENCES "public"."formats"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_grants" ADD CONSTRAINT "role_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_grants" ADD CONSTRAINT "role_grants_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "actors_user_id_unique" ON "actors" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ballots_participant_unique" ON "ballots" USING btree ("participant_id");--> statement-breakpoint
CREATE INDEX "debate_commands_debate_version_idx" ON "debate_commands" USING btree ("debate_id","resulting_version");--> statement-breakpoint
CREATE UNIQUE INDEX "debate_participants_seat_unique" ON "debate_participants" USING btree ("debate_id","role","slot");--> statement-breakpoint
CREATE UNIQUE INDEX "debate_participants_actor_unique" ON "debate_participants" USING btree ("debate_id","actor_id");--> statement-breakpoint
CREATE INDEX "debate_participants_actor_joined_idx" ON "debate_participants" USING btree ("actor_id","joined_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "rating_changes_debate_actor_unique" ON "rating_changes" USING btree ("debate_id","actor_id");--> statement-breakpoint
CREATE INDEX "rating_changes_actor_format_occurred_idx" ON "rating_changes" USING btree ("actor_id","format_id","occurred_at");--> statement-breakpoint
CREATE INDEX "ratings_leaderboard_idx" ON "ratings" USING btree ("format_id","season_id","rating" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "seasons_single_active" ON "seasons" USING btree ("status") WHERE "seasons"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "role_grants_active_unique" ON "role_grants" USING btree ("user_id","role","scope_type",coalesce("scope_id", '')) WHERE "role_grants"."revoked_at" is null;--> statement-breakpoint
ALTER TABLE "debates" ADD CONSTRAINT "debates_created_by_actors_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."actors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debates" ADD CONSTRAINT "debates_format_formats_id_fk" FOREIGN KEY ("format") REFERENCES "public"."formats"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "debates_phase_mode_created_idx" ON "debates" USING btree ("phase","mode","created_at");--> statement-breakpoint
CREATE INDEX "debates_format_completed_idx" ON "debates" USING btree ("format","completed_at");--> statement-breakpoint
ALTER TABLE "debates" ADD CONSTRAINT "debates_mode_check" CHECK ("debates"."mode" in ('casual', 'ranked', 'practice'));--> statement-breakpoint
ALTER TABLE "debates" ADD CONSTRAINT "debates_phase_check" CHECK ("debates"."phase" in ('waiting', 'active', 'completed'));--> statement-breakpoint
ALTER TABLE "debates" ADD CONSTRAINT "debates_visibility_check" CHECK ("debates"."visibility" in ('public', 'unlisted', 'private'));--> statement-breakpoint
ALTER TABLE "debates" ADD CONSTRAINT "debates_outcome_check" CHECK ("debates"."outcome" is null or "debates"."outcome" in ('affirmative', 'negative', 'draw', 'abandoned'));--> statement-breakpoint
ALTER TABLE "debates" ADD CONSTRAINT "debates_lifecycle_check" CHECK (("debates"."phase" = 'waiting' and "debates"."started_at" is null and "debates"."completed_at" is null and "debates"."outcome" is null) or ("debates"."phase" = 'active' and "debates"."started_at" is not null and "debates"."completed_at" is null and "debates"."outcome" is null) or ("debates"."phase" = 'completed' and "debates"."completed_at" is not null and "debates"."outcome" is not null and ("debates"."started_at" is not null or "debates"."outcome" = 'abandoned')));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tombstone_scrubbed" CHECK ("users"."deleted_at" is null or ("users"."email" is null and "users"."username" is null and "users"."image" is null and "users"."name" = ''));