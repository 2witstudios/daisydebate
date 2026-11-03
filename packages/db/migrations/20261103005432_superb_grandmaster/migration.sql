CREATE TABLE "agreement_signatures" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"agreement" text NOT NULL,
	"version" text NOT NULL,
	"season_id" text,
	"room_id" text,
	"signed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "agreement_signatures_once" UNIQUE NULLS NOT DISTINCT("user_id","agreement","version","season_id","room_id"),
	CONSTRAINT "agreement_signatures_agreement_check" CHECK ("agreement" in ('ranked-content-waiver', 'round-capture-notice')),
	CONSTRAINT "agreement_signatures_scope_check" CHECK (("agreement" = 'ranked-content-waiver' and "season_id" is not null and "room_id" is null)
        or ("agreement" = 'round-capture-notice' and "room_id" is not null and "season_id" is null))
);
--> statement-breakpoint
CREATE TABLE "broadcasts" (
	"id" text PRIMARY KEY,
	"round_id" text NOT NULL,
	"delivery_path" text DEFAULT 'owned_hls' NOT NULL,
	"release_policy" jsonb NOT NULL,
	"debaters_read_chat" boolean DEFAULT false NOT NULL,
	"stage_credential_hash" text,
	"egress_id" text,
	"egress_started_at" timestamp with time zone,
	"observer_revoked_at" timestamp with time zone,
	"revocation_failures" integer DEFAULT 0 NOT NULL,
	"next_segment" integer DEFAULT 0 NOT NULL,
	"released_through_at" timestamp with time zone,
	"final_media_end_at" timestamp with time zone,
	"stopped_at" timestamp with time zone,
	"stop_reason" text,
	"completed_at" timestamp with time zone,
	"lease_epoch" integer DEFAULT 0 NOT NULL,
	"lease_owner" text,
	"lease_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "broadcasts_delivery_path_check" CHECK ("delivery_path" in ('owned_hls')),
	CONSTRAINT "broadcasts_release_policy_is_object" CHECK (jsonb_typeof("release_policy") = 'object'),
	CONSTRAINT "broadcasts_release_policy_check" CHECK ("release_policy"->>'kind' in ('delay','round_end','at')),
	CONSTRAINT "broadcasts_cursor_check" CHECK ("next_segment" >= 0 and "revocation_failures" >= 0 and "lease_epoch" >= 0),
	CONSTRAINT "broadcasts_lease_check" CHECK (("lease_owner" is null) = ("lease_until" is null)),
	CONSTRAINT "broadcasts_stop_check" CHECK (("stopped_at" is null) = ("stop_reason" is null))
);
--> statement-breakpoint
ALTER TABLE "rounds" RENAME CONSTRAINT "rounds_rated_ladder_check" TO "rounds_ranked_ladder_check";--> statement-breakpoint
CREATE INDEX "agreement_signatures_season_idx" ON "agreement_signatures" ("season_id");--> statement-breakpoint
CREATE INDEX "agreement_signatures_room_idx" ON "agreement_signatures" ("room_id");--> statement-breakpoint
CREATE UNIQUE INDEX "broadcasts_round_unique" ON "broadcasts" ("round_id");--> statement-breakpoint
CREATE INDEX "broadcasts_open_idx" ON "broadcasts" ("created_at") WHERE "completed_at" is null;--> statement-breakpoint
ALTER TABLE "agreement_signatures" ADD CONSTRAINT "agreement_signatures_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "agreement_signatures" ADD CONSTRAINT "agreement_signatures_season_id_seasons_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "agreement_signatures" ADD CONSTRAINT "agreement_signatures_room_id_rooms_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_ranked_public_check" CHECK ("competition_type" <> 'ranked' or "visibility" = 'public');--> statement-breakpoint
ALTER TABLE "account_entitlement_grants" DROP CONSTRAINT "account_entitlement_grants_entitlement_check", ADD CONSTRAINT "account_entitlement_grants_entitlement_check" CHECK ("entitlement" in ('round_analysis', 'ai_rounds', 'casual_ai_judge'));--> statement-breakpoint
-- WATCH-16: beta approval grants the casual AI judge until billing exists, so
-- every account already approved holds it, as the beta access command now writes.
INSERT INTO "account_entitlement_grants" ("user_id", "entitlement", "source")
SELECT "user_id", 'casual_ai_judge', 'beta'
FROM "account_beta_access"
WHERE "state" = 'approved';
--> statement-breakpoint
-- daisy_broadcast_worker: the hold worker's only credential (ADR 0099, BCAST-4).
-- It reads and updates broadcasts and touches nothing else, so it cannot read or
-- change a Round. Explicit grants only. No password here: staging and production
-- provision the credential out of band.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'daisy_broadcast_worker') THEN
    CREATE ROLE daisy_broadcast_worker LOGIN;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO daisy_broadcast_worker;
--> statement-breakpoint
GRANT SELECT, UPDATE ON broadcasts TO daisy_broadcast_worker;
