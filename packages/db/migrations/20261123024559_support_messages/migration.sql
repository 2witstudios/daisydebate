CREATE TABLE "support_messages" (
	"id" text PRIMARY KEY,
	"form_id" text NOT NULL,
	"fields_digest" text NOT NULL,
	"topic" text NOT NULL,
	"message" text NOT NULL,
	"about" text,
	"reply_email" text NOT NULL,
	"member_user_id" text,
	"state" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_token_digest" text,
	"lease_expires_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "support_messages_topic_check" CHECK ("topic" in ('problem', 'question', 'feedback', 'account', 'safety')),
	CONSTRAINT "support_messages_text_check" CHECK (char_length("message") between 1 and 4000
        and ("about" is null or char_length("about") between 1 and 200)
        and char_length("reply_email") between 3 and 320),
	CONSTRAINT "support_messages_state_check" CHECK ("state" in ('queued', 'leased', 'sent', 'failed', 'cancelled')),
	CONSTRAINT "support_messages_attempts_check" CHECK ("attempts" >= 0),
	CONSTRAINT "support_messages_lease_check" CHECK (("state" = 'leased') = ("lease_token_digest" is not null and "lease_expires_at" is not null) and ("lease_token_digest" is null or "lease_token_digest" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "support_messages_completed_check" CHECK (("state" in ('sent', 'failed', 'cancelled')) = ("completed_at" is not null)),
	CONSTRAINT "support_messages_error_check" CHECK ("last_error_code" is null or "last_error_code" in ('delivery', 'delivery-unknown', 'suppressed', 'not-owed', 'unreadable')),
	CONSTRAINT "support_messages_digest_check" CHECK ("fields_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "support_messages_version_idx" ON "support_messages" ("form_id","fields_digest");--> statement-breakpoint
CREATE INDEX "support_messages_due_idx" ON "support_messages" ("state","next_attempt_at");--> statement-breakpoint
CREATE INDEX "support_messages_created_idx" ON "support_messages" ("created_at");--> statement-breakpoint
CREATE INDEX "support_messages_member_idx" ON "support_messages" ("member_user_id");--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_member_user_id_users_id_fkey" FOREIGN KEY ("member_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
