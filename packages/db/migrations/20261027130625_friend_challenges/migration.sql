CREATE TABLE "messaging_friend_challenges" (
	"room_id" text PRIMARY KEY,
	"challenger_actor_id" text NOT NULL,
	"challenged_actor_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "messaging_friend_challenges_distinct" CHECK ("challenger_actor_id" <> "challenged_actor_id")
);
--> statement-breakpoint
CREATE INDEX "messaging_friend_challenges_challenged_idx" ON "messaging_friend_challenges" ("challenged_actor_id");--> statement-breakpoint
CREATE INDEX "messaging_friend_challenges_challenger_idx" ON "messaging_friend_challenges" ("challenger_actor_id");--> statement-breakpoint
ALTER TABLE "messaging_friend_challenges" ADD CONSTRAINT "messaging_friend_challenges_room_id_rooms_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "messaging_friend_challenges" ADD CONSTRAINT "messaging_friend_challenges_challenger_actor_id_actors_id_fkey" FOREIGN KEY ("challenger_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "messaging_friend_challenges" ADD CONSTRAINT "messaging_friend_challenges_challenged_actor_id_actors_id_fkey" FOREIGN KEY ("challenged_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;