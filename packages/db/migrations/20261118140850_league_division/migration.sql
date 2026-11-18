ALTER TABLE "organizations" ADD COLUMN "league_division" text;--> statement-breakpoint
-- Every league so far rated on Open (PR 792): it keeps that division. Daisy
-- (kind league) runs every division and carries none.
UPDATE "organizations" SET "league_division" = 'open'
  WHERE "kind" = 'league' AND "id" <> 'fo05z182lha0a3usciy9wr2r';--> statement-breakpoint
-- The rewrite above may queue deferred constraint triggers on organizations;
-- fire them now so the ALTER below never meets pending trigger events.
SET CONSTRAINTS ALL IMMEDIATE;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_league_division_check" CHECK (("kind" = 'league' and "id" <> 'fo05z182lha0a3usciy9wr2r') = ("league_division" is not null) and ("league_division" is null or "league_division" in ('open', 'youth'))) NOT VALID;