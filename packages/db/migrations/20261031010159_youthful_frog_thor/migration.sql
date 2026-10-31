CREATE TABLE "member_leagues" (
	"user_id" text,
	"league" text,
	CONSTRAINT "member_leagues_pkey" PRIMARY KEY("user_id","league"),
	CONSTRAINT "member_leagues_league_check" CHECK (char_length("league") between 1 and 60)
);
--> statement-breakpoint
ALTER TABLE "member_onboarding" DROP CONSTRAINT "member_onboarding_formats_check";--> statement-breakpoint
ALTER TABLE "member_onboarding" ADD COLUMN "club_name" text;--> statement-breakpoint
ALTER TABLE "member_onboarding" DROP COLUMN "formats";--> statement-breakpoint
ALTER TABLE "member_leagues" ADD CONSTRAINT "member_leagues_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;