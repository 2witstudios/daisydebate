ALTER TABLE "organizations" ADD COLUMN "league_division" text;--> statement-breakpoint
-- Every league so far rated on Open (PR 792): it keeps that division.
UPDATE "organizations" SET "league_division" = 'open' WHERE "kind" = 'league';--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_league_division_check" CHECK (("kind" = 'league') = ("league_division" is not null) and ("league_division" is null or "league_division" in ('open', 'youth')));