ALTER TABLE "rounds" ADD COLUMN "published_resolution_id" text;--> statement-breakpoint
CREATE INDEX "rounds_published_resolution_idx" ON "rounds" ("published_resolution_id");--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_published_resolution_id_published_resolutions_id_fkey" FOREIGN KEY ("published_resolution_id") REFERENCES "published_resolutions"("id") ON DELETE RESTRICT;