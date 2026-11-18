CREATE TABLE "league_requests" (
	"id" text PRIMARY KEY,
	"form_id" text NOT NULL,
	"fields_digest" text NOT NULL,
	"league_name" text NOT NULL,
	"schools" text NOT NULL,
	"seasons" text NOT NULL,
	"style" text NOT NULL,
	"divisions" text NOT NULL,
	"needs" text NOT NULL,
	"contact_name" text NOT NULL,
	"contact_role" text NOT NULL,
	"contact_email" text NOT NULL,
	"contact_phone" text,
	"state" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_token_digest" text,
	"lease_expires_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "league_requests_schools_check" CHECK ("schools" in ('under-10', '10-25', '26-50', 'over-50')),
	CONSTRAINT "league_requests_seasons_check" CHECK ("seasons" in ('1', '2', '3-plus')),
	CONSTRAINT "league_requests_style_check" CHECK ("style" in ('freestyle')),
	CONSTRAINT "league_requests_divisions_check" CHECK ("divisions" in ('youth', 'open', 'youth-and-open')),
	CONSTRAINT "league_requests_text_check" CHECK (char_length("league_name") between 1 and 120
        and char_length("needs") <= 4000
        and char_length("contact_name") between 1 and 120
        and char_length("contact_role") between 1 and 120
        and char_length("contact_email") between 3 and 320
        and ("contact_phone" is null or char_length("contact_phone") between 1 and 32)),
	CONSTRAINT "league_requests_state_check" CHECK ("state" in ('queued', 'leased', 'sent', 'failed', 'cancelled')),
	CONSTRAINT "league_requests_attempts_check" CHECK ("attempts" >= 0),
	CONSTRAINT "league_requests_lease_check" CHECK (("state" = 'leased') = ("lease_token_digest" is not null and "lease_expires_at" is not null) and ("lease_token_digest" is null or "lease_token_digest" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "league_requests_completed_check" CHECK (("state" in ('sent', 'failed', 'cancelled')) = ("completed_at" is not null)),
	CONSTRAINT "league_requests_error_check" CHECK ("last_error_code" is null or "last_error_code" in ('delivery', 'delivery-unknown', 'suppressed', 'not-owed')),
	CONSTRAINT "league_requests_digest_check" CHECK ("fields_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "league_requests_version_idx" ON "league_requests" ("form_id","fields_digest");--> statement-breakpoint
CREATE INDEX "league_requests_due_idx" ON "league_requests" ("state","next_attempt_at");--> statement-breakpoint
CREATE INDEX "league_requests_created_idx" ON "league_requests" ("created_at");