-- Nothing writes a scheduled season; a row that exists anyway must not refuse the
-- CHECK, and a closed season has an end, or the ratings reads refuse it.
UPDATE "seasons" SET "status" = 'closed', "ends_at" = coalesce("ends_at", "starts_at" + interval '1 millisecond') WHERE "status" = 'scheduled';--> statement-breakpoint
SET CONSTRAINTS ALL IMMEDIATE;--> statement-breakpoint
DROP TABLE "role_grants";--> statement-breakpoint
ALTER TABLE "seasons" DROP CONSTRAINT "seasons_status_check", ADD CONSTRAINT "seasons_status_check" CHECK ("status" in ('active', 'closed'));
