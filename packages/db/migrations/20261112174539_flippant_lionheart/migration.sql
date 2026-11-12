ALTER TABLE "media_sessions" ADD COLUMN "post_round_call_opened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "media_sessions" ADD COLUMN "room_vacant_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "post_round_call" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "post_round_call" boolean DEFAULT false NOT NULL;