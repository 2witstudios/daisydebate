-- ISSUE-770: a closed Room's terminal status is 'closed'; 'abandoned' is a
-- Round's (no-show or start-horizon end). The check is swapped around a
-- rewrite of the existing closed Rooms; nothing else reads the old value.
ALTER TABLE "rooms" DROP CONSTRAINT "rooms_status_check";--> statement-breakpoint
UPDATE "rooms" SET "status" = 'closed' WHERE "status" = 'abandoned';--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_status_check" CHECK ("status" in ('assembling', 'ready', 'started', 'closed'));
