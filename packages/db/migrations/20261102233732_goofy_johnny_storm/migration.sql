CREATE TABLE "broadcasts" (
	"id" text PRIMARY KEY,
	"round_id" text NOT NULL,
	"delivery_path" text DEFAULT 'owned_hls' NOT NULL,
	"release_policy" jsonb NOT NULL,
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
CREATE UNIQUE INDEX "broadcasts_round_unique" ON "broadcasts" ("round_id");--> statement-breakpoint
CREATE INDEX "broadcasts_open_idx" ON "broadcasts" ("created_at") WHERE "completed_at" is null;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;