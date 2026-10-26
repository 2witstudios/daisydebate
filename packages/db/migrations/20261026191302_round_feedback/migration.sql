CREATE TABLE "round_feedback" (
	"round_id" text PRIMARY KEY,
	"freeze_revision" integer NOT NULL,
	"status" text NOT NULL,
	"attempts" integer NOT NULL,
	"lease_token_digest" text,
	"lease_expires_at" timestamp with time zone,
	"model" text NOT NULL,
	"feedback" jsonb,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "round_feedback_feedback_is_object" CHECK (jsonb_typeof("feedback") = 'object'),
	CONSTRAINT "round_feedback_status_check" CHECK ("status" in ('leased', 'succeeded', 'failed')),
	CONSTRAINT "round_feedback_attempts_check" CHECK ("attempts" > 0 and "input_tokens" >= 0 and "output_tokens" >= 0),
	CONSTRAINT "round_feedback_lease_check" CHECK (("status" = 'leased' and "lease_token_digest" ~ '^[0-9a-f]{64}$' and "lease_expires_at" is not null) or ("status" <> 'leased' and "lease_token_digest" is null and "lease_expires_at" is null)),
	CONSTRAINT "round_feedback_result_check" CHECK (("status" = 'succeeded') = ("feedback" is not null) and ("status" = 'leased') = ("completed_at" is null))
);
--> statement-breakpoint
CREATE INDEX "round_feedback_lease_idx" ON "round_feedback" ("status","lease_expires_at");--> statement-breakpoint
CREATE INDEX "round_feedback_created_idx" ON "round_feedback" ("created_at");--> statement-breakpoint
ALTER TABLE "round_feedback" ADD CONSTRAINT "round_feedback_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "round_feedback" ADD CONSTRAINT "round_feedback_freeze_revision_fk" FOREIGN KEY ("round_id","freeze_revision") REFERENCES "round_transcript_freezes"("round_id","revision") ON DELETE CASCADE;