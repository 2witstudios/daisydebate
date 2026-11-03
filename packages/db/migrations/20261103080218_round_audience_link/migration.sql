ALTER TABLE "broadcasts" ADD COLUMN "feed_key" text;--> statement-breakpoint
-- A Broadcast opened before this column has its objects under its id, so that stays its key.
UPDATE "broadcasts" SET "feed_key" = "id";--> statement-breakpoint
ALTER TABLE "broadcasts" ALTER COLUMN "feed_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "audience_link_hash" text;