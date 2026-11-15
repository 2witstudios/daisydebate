ALTER TABLE "rooms" ADD COLUMN "standing_template_id" text GENERATED ALWAYS AS (case when lobby_kind = 'standing' then template_id else null end) STORED;--> statement-breakpoint
CREATE INDEX "rooms_template_idx" ON "rooms" ("template_id");--> statement-breakpoint
CREATE INDEX "rooms_standing_template_idx" ON "rooms" ("lobby_id","standing_template_id");--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_template_fk" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "rooms" DROP CONSTRAINT "rooms_offered_template_fk", ADD CONSTRAINT "rooms_offered_template_fk" FOREIGN KEY ("lobby_id","standing_template_id") REFERENCES "lobby_templates"("lobby_id","template_id") ON DELETE RESTRICT;