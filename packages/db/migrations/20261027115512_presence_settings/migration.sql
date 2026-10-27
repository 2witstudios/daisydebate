CREATE TABLE "messaging_presence_settings" (
	"actor_id" text PRIMARY KEY,
	"hidden" boolean NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messaging_presence_settings" ADD CONSTRAINT "messaging_presence_settings_actor_id_actors_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;