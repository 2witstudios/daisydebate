ALTER TABLE "pending_commands" ADD COLUMN "preapproval" jsonb;--> statement-breakpoint
ALTER TABLE "pending_commands" ALTER COLUMN "target_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pending_commands" ALTER COLUMN "desired_state" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pending_commands" ALTER COLUMN "expected_revision" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pending_commands" ADD CONSTRAINT "pending_commands_variant_check" CHECK (("preapproval" is null and "target_user_id" is not null and "desired_state" is not null and "expected_revision" is not null) or ("preapproval" is not null and "target_user_id" is null and "desired_state" is null and "expected_revision" is null));