CREATE TABLE "agreement_signatures" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"agreement" text NOT NULL,
	"version" text NOT NULL,
	"season_id" text,
	"room_id" text,
	"signed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "agreement_signatures_once" UNIQUE NULLS NOT DISTINCT("user_id","agreement","version","season_id","room_id"),
	CONSTRAINT "agreement_signatures_agreement_check" CHECK ("agreement" in ('ranked-content-waiver', 'round-capture-notice')),
	CONSTRAINT "agreement_signatures_scope_check" CHECK (("agreement" = 'ranked-content-waiver' and "season_id" is not null and "room_id" is null)
        or ("agreement" = 'round-capture-notice' and "room_id" is not null and "season_id" is null))
);
--> statement-breakpoint
CREATE INDEX "agreement_signatures_season_idx" ON "agreement_signatures" ("season_id");--> statement-breakpoint
CREATE INDEX "agreement_signatures_room_idx" ON "agreement_signatures" ("room_id");--> statement-breakpoint
ALTER TABLE "agreement_signatures" ADD CONSTRAINT "agreement_signatures_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "agreement_signatures" ADD CONSTRAINT "agreement_signatures_season_id_seasons_id_fkey" FOREIGN KEY ("season_id") REFERENCES "seasons"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "agreement_signatures" ADD CONSTRAINT "agreement_signatures_room_id_rooms_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE;