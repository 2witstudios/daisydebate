CREATE TABLE "ai_judge_profiles" (
	"actor_id" text PRIMARY KEY,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_entitlement_grants" (
	"user_id" text,
	"entitlement" text,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_entitlement_grants_pkey" PRIMARY KEY("user_id","entitlement","source"),
	CONSTRAINT "account_entitlement_grants_entitlement_check" CHECK ("entitlement" in ('round_analysis', 'ai_rounds')),
	CONSTRAINT "account_entitlement_grants_source_check" CHECK ("source" in ('beta'))
);
--> statement-breakpoint
CREATE TABLE "round_analyses" (
	"round_id" text NOT NULL,
	"round_participant_id" text PRIMARY KEY,
	"freeze_revision" integer NOT NULL,
	"status" text NOT NULL,
	"attempts" integer NOT NULL,
	"lease_token_digest" text,
	"lease_expires_at" timestamp with time zone,
	"model" text NOT NULL,
	"report" jsonb,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "round_analyses_report_is_object" CHECK (jsonb_typeof("report") = 'object'),
	CONSTRAINT "round_analyses_status_check" CHECK ("status" in ('leased', 'succeeded', 'failed')),
	CONSTRAINT "round_analyses_attempts_check" CHECK ("attempts" > 0 and "input_tokens" >= 0 and "output_tokens" >= 0),
	CONSTRAINT "round_analyses_lease_check" CHECK (("status" = 'leased' and "lease_token_digest" ~ '^[0-9a-f]{64}$' and "lease_expires_at" is not null) or ("status" <> 'leased' and "lease_token_digest" is null and "lease_expires_at" is null)),
	CONSTRAINT "round_analyses_result_check" CHECK (("status" = 'succeeded') = ("report" is not null) and ("status" = 'leased') = ("completed_at" is null))
);
--> statement-breakpoint
-- Round analysis replaces the ADR 0071 coaching pass; its beta rows are not carried over (ADR 0023).
DROP TABLE "round_feedback";--> statement-breakpoint
CREATE INDEX "round_analyses_freeze_revision_idx" ON "round_analyses" ("round_id","freeze_revision");--> statement-breakpoint
CREATE INDEX "round_analyses_lease_idx" ON "round_analyses" ("status","lease_expires_at");--> statement-breakpoint
CREATE INDEX "round_analyses_created_idx" ON "round_analyses" ("created_at");--> statement-breakpoint
ALTER TABLE "ai_judge_profiles" ADD CONSTRAINT "ai_judge_profiles_actor_id_actors_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "account_entitlement_grants" ADD CONSTRAINT "account_entitlement_grants_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "round_analyses" ADD CONSTRAINT "round_analyses_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "round_analyses" ADD CONSTRAINT "round_analyses_round_participant_id_round_participants_id_fkey" FOREIGN KEY ("round_participant_id") REFERENCES "round_participants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "round_analyses" ADD CONSTRAINT "round_analyses_freeze_revision_fk" FOREIGN KEY ("round_id","freeze_revision") REFERENCES "round_transcript_freezes"("round_id","revision") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "usage_reservations" DROP CONSTRAINT "usage_reservations_kind_check";--> statement-breakpoint
-- ISSUE-774: the reservation is an AI round, never "practice".
UPDATE "usage_reservations" SET "kind" = 'ai_round' WHERE "kind" = 'ai_practice';--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD CONSTRAINT "usage_reservations_kind_check" CHECK ("kind" in ('ai_round'));--> statement-breakpoint
-- ISSUE-750: the AI judge is not a bot debater; it moves to its own table.
INSERT INTO "ai_judge_profiles" ("actor_id", "name") VALUES ('a1i2j3u4d5g6e7a8i9j0u1d2', 'The Panel');--> statement-breakpoint
DELETE FROM "bot_profiles" WHERE "actor_id" = 'a1i2j3u4d5g6e7a8i9j0u1d2';--> statement-breakpoint
-- ISSUE-779: every approved beta account holds its beta grants as their own fact.
INSERT INTO "account_entitlement_grants" ("user_id", "entitlement", "source")
SELECT b."user_id", e."entitlement", 'beta'
FROM "account_beta_access" b
CROSS JOIN (VALUES ('round_analysis'), ('ai_rounds')) AS e("entitlement")
WHERE b."state" = 'approved';