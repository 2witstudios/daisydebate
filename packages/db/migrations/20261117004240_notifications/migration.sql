ALTER TABLE "notifications" ADD COLUMN "surfaced_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
--> A row written before resurfacing existed last reached its member when it was written.
UPDATE "notifications" SET "surfaced_at" = "created_at";--> statement-breakpoint
DROP INDEX "notifications_user_idx";--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" ("user_id","surfaced_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_subject_check", ADD CONSTRAINT "notifications_subject_check" CHECK (("kind" in ('followed_debater_live', 'recording_ready')) = ("round_id" is not null)
        and ("kind" in ('room_invitation')) = ("room_invitation_id" is not null)
        and ("kind" in ('challenge_received')) = ("challenge_id" is not null));