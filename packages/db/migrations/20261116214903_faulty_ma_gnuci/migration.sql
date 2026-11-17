CREATE TABLE "member_profiles" (
	"actor_id" text PRIMARY KEY,
	"id" text NOT NULL,
	"display_name" text,
	"bio" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "member_profiles_display_name_length" CHECK ("display_name" is null or char_length("display_name") between 1 and 40),
	CONSTRAINT "member_profiles_bio_length" CHECK ("bio" is null or char_length("bio") between 1 and 160),
	CONSTRAINT "member_profiles_version_positive" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE TABLE "profile_photos" (
	"id" text PRIMARY KEY,
	"actor_id" text NOT NULL,
	"status" text NOT NULL,
	"check_verdict" text,
	"object_prefix" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"delete_attempts" integer DEFAULT 0 NOT NULL,
	"delete_after" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "profile_photos_status_check" CHECK ("status" in ('in_review', 'published', 'rejected', 'removed', 'withdrawn', 'erased')),
	CONSTRAINT "profile_photos_check_verdict_check" CHECK ("check_verdict" is null or "check_verdict" in ('allow', 'review', 'block')),
	CONSTRAINT "profile_photos_ended_check" CHECK (("status" in ('in_review','published')) = ("ended_at" is null)),
	CONSTRAINT "profile_photos_delete_after_check" CHECK (("ended_at" is null) = ("delete_after" is null)),
	CONSTRAINT "profile_photos_delete_attempts_check" CHECK ("delete_attempts" >= 0),
	CONSTRAINT "profile_photos_version_positive" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "member_profiles_id_unique" ON "member_profiles" ("id");--> statement-breakpoint
CREATE INDEX "profile_photos_actor_idx" ON "profile_photos" ("actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "profile_photos_one_published" ON "profile_photos" ("actor_id") WHERE "status" = 'published';--> statement-breakpoint
CREATE UNIQUE INDEX "profile_photos_one_in_review" ON "profile_photos" ("actor_id") WHERE "status" = 'in_review';--> statement-breakpoint
CREATE UNIQUE INDEX "profile_photos_object_prefix_unique" ON "profile_photos" ("object_prefix");--> statement-breakpoint
CREATE INDEX "profile_photos_review_queue_idx" ON "profile_photos" ("created_at","id") WHERE "status" = 'in_review';--> statement-breakpoint
CREATE INDEX "profile_photos_deletion_idx" ON "profile_photos" ("delete_after","id") WHERE "ended_at" is not null;--> statement-breakpoint
ALTER TABLE "member_profiles" ADD CONSTRAINT "member_profiles_actor_id_actors_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "profile_photos" ADD CONSTRAINT "profile_photos_actor_id_actors_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE CASCADE;--> statement-breakpoint
-- NOT VALID: no code writes users.image, and an existing row can never make
-- this migration refuse a deploy; every new or changed row is checked.
ALTER TABLE "users" ADD CONSTRAINT "users_image_unused" CHECK ("image" is null) NOT VALID;--> statement-breakpoint
ALTER TABLE "content_reports" DROP CONSTRAINT "content_reports_target_kind_check", ADD CONSTRAINT "content_reports_target_kind_check" CHECK ("target_kind" in ('round', 'recording', 'chat_message', 'ballot_feedback', 'profile_photo', 'profile_display_name', 'profile_bio'));