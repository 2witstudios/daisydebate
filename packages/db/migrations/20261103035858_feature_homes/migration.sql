-- Nothing writes a scheduled season; a row that exists anyway must not refuse the CHECK.
UPDATE "seasons" SET "status" = 'closed' WHERE "status" = 'scheduled';--> statement-breakpoint
SET CONSTRAINTS ALL IMMEDIATE;--> statement-breakpoint
DROP TABLE "role_grants";--> statement-breakpoint
ALTER TABLE "seasons" DROP CONSTRAINT "seasons_status_check", ADD CONSTRAINT "seasons_status_check" CHECK ("status" in ('active', 'closed'));
