-- ADR 0077 (A1): a command may be abandoned only once its latest signed PUT
-- can no longer commit, so each send records when it was signed. An open
-- row was last signed when its intent was written.
ALTER TABLE "pending_commands" ADD COLUMN "last_signed_at" timestamp with time zone;--> statement-breakpoint
UPDATE "pending_commands" SET "last_signed_at" = "created_at";--> statement-breakpoint
ALTER TABLE "pending_commands" ALTER COLUMN "last_signed_at" SET NOT NULL;
