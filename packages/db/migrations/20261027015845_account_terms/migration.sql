CREATE TABLE "account_terms" (
	"user_id" text PRIMARY KEY,
	"terms_version" text NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_terms" ADD CONSTRAINT "account_terms_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT;