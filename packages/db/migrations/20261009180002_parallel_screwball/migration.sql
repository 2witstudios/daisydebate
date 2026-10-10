ALTER TABLE "formats" ADD COLUMN "created_by_actor_id" text;--> statement-breakpoint
CREATE INDEX "formats_created_by_actor_idx" ON "formats" ("created_by_actor_id");--> statement-breakpoint
ALTER TABLE "formats" ADD CONSTRAINT "formats_created_by_actor_id_actors_id_fkey" FOREIGN KEY ("created_by_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;