CREATE TABLE "room_commands" (
	"command_id" text PRIMARY KEY,
	"room_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"type" text NOT NULL,
	"payload_digest" text NOT NULL,
	"result" jsonb NOT NULL,
	"resulting_version" integer NOT NULL,
	"applied_at" timestamp with time zone NOT NULL,
	CONSTRAINT "room_commands_digest_check" CHECK ("payload_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "room_commands_version_positive" CHECK ("resulting_version" > 0),
	CONSTRAINT "room_commands_result_is_object" CHECK (jsonb_typeof("result") = 'object')
);
--> statement-breakpoint
DROP INDEX "rounds_room_idx";--> statement-breakpoint
ALTER TABLE "room_participants" ADD COLUMN "readiness_command_id" text;--> statement-breakpoint
ALTER TABLE "room_participants" ADD COLUMN "readiness_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "host_actor_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "title" text NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "topic" text NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "visibility" text NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "room_config_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_room_unique" UNIQUE("room_id");--> statement-breakpoint
CREATE INDEX "room_commands_room_idx" ON "room_commands" ("room_id","applied_at");--> statement-breakpoint
CREATE INDEX "room_commands_actor_idx" ON "room_commands" ("actor_id");--> statement-breakpoint
CREATE INDEX "room_commands_applied_idx" ON "room_commands" ("applied_at");--> statement-breakpoint
CREATE INDEX "rooms_host_actor_idx" ON "rooms" ("host_actor_id");--> statement-breakpoint
CREATE INDEX "rooms_lobby_idx" ON "rooms" ("visibility","status","created_at");--> statement-breakpoint
ALTER TABLE "room_commands" ADD CONSTRAINT "room_commands_room_id_rooms_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "room_commands" ADD CONSTRAINT "room_commands_actor_id_actors_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_host_actor_id_actors_id_fkey" FOREIGN KEY ("host_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_visibility_check" CHECK ("visibility" in ('public', 'unlisted', 'private'));--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_title_nonempty" CHECK (length(trim("title")) > 0);--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_topic_nonempty" CHECK (length(trim("topic")) > 0);--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_version_positive" CHECK ("version" > 0);