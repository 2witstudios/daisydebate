CREATE TABLE "consent_record" (
	"user_id" text PRIMARY KEY,
	"version" integer NOT NULL,
	"necessary" text NOT NULL,
	"analytics" text NOT NULL,
	"replay" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "consent_record_version" CHECK ("version" = 1),
	CONSTRAINT "consent_record_necessary" CHECK ("necessary" = 'granted'),
	CONSTRAINT "consent_record_analytics" CHECK ("analytics" in ('granted', 'denied', 'unanswered')),
	CONSTRAINT "consent_record_replay" CHECK ("replay" in ('granted', 'denied', 'unanswered'))
);
--> statement-breakpoint
ALTER TABLE "consent_record" ADD CONSTRAINT "consent_record_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;