CREATE TABLE "member_interests" (
	"user_id" text,
	"interest" text,
	CONSTRAINT "member_interests_pkey" PRIMARY KEY("user_id","interest"),
	CONSTRAINT "member_interests_interest_check" CHECK ("interest" in ('debate', 'coach', 'judge', 'watch'))
);
--> statement-breakpoint
CREATE TABLE "member_onboarding" (
	"user_id" text PRIMARY KEY,
	"club" text,
	"experience" text,
	"formats" text[] DEFAULT '{}'::text[] NOT NULL,
	"length" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "member_onboarding_club_check" CHECK ("club" is null or "club" in ('joining', 'starting', 'own')),
	CONSTRAINT "member_onboarding_experience_check" CHECK ("experience" is null or "experience" in ('new', 'class', 'circuit', 'veteran')),
	CONSTRAINT "member_onboarding_formats_check" CHECK ("formats" <@ array['one-on-one', 'teams']::text[]),
	CONSTRAINT "member_onboarding_length_check" CHECK ("length" is null or "length" in ('quick', 'full')),
	CONSTRAINT "member_onboarding_version_positive" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE TABLE "member_topics" (
	"user_id" text,
	"topic" text,
	CONSTRAINT "member_topics_pkey" PRIMARY KEY("user_id","topic"),
	CONSTRAINT "member_topics_topic_check" CHECK ("topic" in ('politics', 'economics', 'philosophy', 'ethics', 'law', 'science-and-tech', 'environment', 'education', 'health', 'international', 'culture', 'sports'))
);
--> statement-breakpoint
ALTER TABLE "member_interests" ADD CONSTRAINT "member_interests_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "member_onboarding" ADD CONSTRAINT "member_onboarding_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "member_topics" ADD CONSTRAINT "member_topics_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;