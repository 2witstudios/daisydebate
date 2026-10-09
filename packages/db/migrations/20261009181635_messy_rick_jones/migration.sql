CREATE TABLE "account_age" (
	"user_id" text PRIMARY KEY,
	"birth_month" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "account_age_version_positive" CHECK ("version" > 0),
	CONSTRAINT "account_age_birth_month_shape" CHECK ("birth_month" ~ '^[1-9][0-9]{3}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
CREATE TABLE "privacy_jobs" (
	"id" text PRIMARY KEY,
	"subject_ref" text NOT NULL,
	"vendor" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"retry_at" timestamp with time zone NOT NULL,
	"succeeded_at" timestamp with time zone,
	CONSTRAINT "privacy_jobs_vendor_valid" CHECK ("vendor" in ('sentry', 'posthog', 'beehiiv', 'resend', 'object-storage')),
	CONSTRAINT "privacy_jobs_status_valid" CHECK ("status" in ('pending', 'succeeded')),
	CONSTRAINT "privacy_jobs_attempts_nonnegative" CHECK ("attempts" >= 0),
	CONSTRAINT "privacy_jobs_success_consistent" CHECK (("status" = 'succeeded') = ("succeeded_at" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "privacy_jobs_subject_vendor_unique" ON "privacy_jobs" ("subject_ref","vendor");--> statement-breakpoint
ALTER TABLE "account_age" ADD CONSTRAINT "account_age_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "privacy_jobs" ADD CONSTRAINT "privacy_jobs_subject_ref_users_id_fkey" FOREIGN KEY ("subject_ref") REFERENCES "users"("id");