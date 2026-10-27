-- ADR 0077 (A1): a command may be abandoned only once its latest signed PUT
-- can no longer commit, so each send records when it was signed. An open row
-- may have been resent before this column existed; every send is audited
-- after it is signed, so the command's latest audit time is no earlier than
-- its latest signing, and the window never starts too early.
ALTER TABLE "pending_commands" ADD COLUMN "last_signed_at" timestamp with time zone;--> statement-breakpoint
UPDATE "pending_commands" p SET "last_signed_at" = GREATEST(
  p."created_at",
  COALESCE((SELECT max(a."at") FROM "audit_events" a WHERE a."command_id" = p."command_id"), p."created_at")
);--> statement-breakpoint
ALTER TABLE "pending_commands" ALTER COLUMN "last_signed_at" SET NOT NULL;
