ALTER TABLE "rounds" ADD COLUMN "visibility" text;--> statement-breakpoint
ALTER TABLE "room_participants" ADD CONSTRAINT "room_participants_readiness_version_nonnegative" CHECK ("readiness_version" >= 0);--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_change_version_positive" CHECK ("change_version" > 0);--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_visibility_check" CHECK ("visibility" is null or "visibility" in ('public', 'unlisted', 'private'));--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_room_freeze_complete" CHECK ("room_id" is null or ("room_config_snapshot" is not null and "visibility" is not null));