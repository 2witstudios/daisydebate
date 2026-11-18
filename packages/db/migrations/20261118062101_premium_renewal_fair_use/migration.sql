ALTER TABLE "billing_subscriptions" ADD COLUMN "renewal_off" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD COLUMN "amount_minor" integer;--> statement-breakpoint
CREATE INDEX "usage_reservations_actor_day_idx" ON "usage_reservations" ("actor_id","kind","reserved_at");