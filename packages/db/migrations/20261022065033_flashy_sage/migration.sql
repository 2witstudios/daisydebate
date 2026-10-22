CREATE TABLE "ai_allowance_grants" (
	"id" text PRIMARY KEY,
	"actor_id" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "ai_allowance_grants_period_check" CHECK ("period_end" > "period_start")
);
--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD COLUMN "reserved_at" timestamp with time zone;
--> statement-breakpoint
-- Existing rows retain unknown admission provenance. Only future inserts use PG time.
ALTER TABLE "usage_reservations" ALTER COLUMN "reserved_at" SET DEFAULT clock_timestamp();--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD COLUMN "refunded_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "ai_allowance_grants_actor_period_idx" ON "ai_allowance_grants" ("actor_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX "usage_reservations_actor_period_idx" ON "usage_reservations" ("actor_id","kind","reserved_at");--> statement-breakpoint
ALTER TABLE "ai_allowance_grants" ADD CONSTRAINT "ai_allowance_grants_actor_id_actors_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD CONSTRAINT "usage_reservations_refund_check" CHECK ("refunded_at" is null or ("counted_at" is not null and "refunded_at" >= "counted_at"));--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD CONSTRAINT "usage_reservations_admission_check" CHECK ("reserved_at" is null or "counted_at" is null or "counted_at" >= "reserved_at");
--> statement-breakpoint
-- btree_gist is provided by the earlier speaking-history migration.
ALTER TABLE ai_allowance_grants ADD CONSTRAINT ai_allowance_grants_no_overlap
EXCLUDE USING gist (actor_id WITH =, tstzrange(period_start, period_end, '[)') WITH &&)
WHERE (revoked_at IS NULL);
