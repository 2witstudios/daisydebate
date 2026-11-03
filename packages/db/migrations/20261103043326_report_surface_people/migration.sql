-- ADR 0105: a report made from the people list names that surface. Rows move
-- before the check returns, so this cannot refuse a deploy.
ALTER TABLE "reports" DROP CONSTRAINT "reports_surface_check";--> statement-breakpoint
UPDATE "reports" SET "surface" = 'people' WHERE "surface" = 'online';--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_surface_check" CHECK ("surface" in ('people', 'profile', 'watch'));
