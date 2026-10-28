CREATE TABLE "observation_purge_jobs" (
	"user_id" text PRIMARY KEY,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"retry_at" timestamp with time zone NOT NULL,
	"succeeded_at" timestamp with time zone,
	CONSTRAINT "observation_purge_jobs_status_valid" CHECK ("status" in ('pending', 'succeeded')),
	CONSTRAINT "observation_purge_jobs_attempts_nonnegative" CHECK ("attempts" >= 0),
	CONSTRAINT "observation_purge_jobs_success_consistent" CHECK (("status" = 'succeeded') = ("succeeded_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "observation_purge_jobs" ADD CONSTRAINT "observation_purge_jobs_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;