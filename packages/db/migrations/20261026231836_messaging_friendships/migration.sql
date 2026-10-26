CREATE TABLE "messaging_friendships" (
	"low_actor_id" text,
	"high_actor_id" text,
	"requester_actor_id" text NOT NULL,
	"state" text NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	CONSTRAINT "messaging_friendships_pkey" PRIMARY KEY("low_actor_id","high_actor_id"),
	CONSTRAINT "messaging_friendships_order" CHECK ("low_actor_id" < "high_actor_id"),
	CONSTRAINT "messaging_friendships_requester" CHECK ("requester_actor_id" in ("low_actor_id", "high_actor_id")),
	CONSTRAINT "messaging_friendships_state" CHECK ("state" in ('pending', 'accepted')),
	CONSTRAINT "messaging_friendships_time" CHECK (("state" = 'pending' and "accepted_at" is null) or ("state" = 'accepted' and "accepted_at" is not null and "accepted_at" >= "requested_at"))
);
--> statement-breakpoint
CREATE INDEX "messaging_friendships_high_actor_idx" ON "messaging_friendships" ("high_actor_id");--> statement-breakpoint
ALTER TABLE "messaging_friendships" ADD CONSTRAINT "messaging_friendships_low_actor_id_actors_id_fkey" FOREIGN KEY ("low_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "messaging_friendships" ADD CONSTRAINT "messaging_friendships_high_actor_id_actors_id_fkey" FOREIGN KEY ("high_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "messaging_friendships" ADD CONSTRAINT "messaging_friendships_contact_fk" FOREIGN KEY ("low_actor_id","high_actor_id") REFERENCES "messaging_contact_pairs"("low_actor_id","high_actor_id") ON DELETE CASCADE;