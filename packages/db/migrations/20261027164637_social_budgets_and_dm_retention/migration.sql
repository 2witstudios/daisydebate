CREATE TABLE "messaging_retained_authors" (
	"channel_id" text,
	"actor_id" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "messaging_retained_authors_pkey" PRIMARY KEY("channel_id","actor_id")
);
--> statement-breakpoint
CREATE TABLE "messaging_social_declines" (
	"decliner_actor_id" text,
	"requester_actor_id" text,
	"low_actor_id" text NOT NULL,
	"high_actor_id" text NOT NULL,
	"declined_count" bigint NOT NULL,
	"last_declined_at" timestamp with time zone NOT NULL,
	"blocked_until" timestamp with time zone,
	CONSTRAINT "messaging_social_declines_pkey" PRIMARY KEY("decliner_actor_id","requester_actor_id"),
	CONSTRAINT "messaging_social_declines_pair" CHECK (("low_actor_id" = "decliner_actor_id" and "high_actor_id" = "requester_actor_id") or ("low_actor_id" = "requester_actor_id" and "high_actor_id" = "decliner_actor_id")),
	CONSTRAINT "messaging_social_declines_count" CHECK ("declined_count" between 0 and 9007199254740991)
);
--> statement-breakpoint
ALTER TABLE "messaging_social_commands" ADD COLUMN "unrelated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "messaging_retained_authors_actor_idx" ON "messaging_retained_authors" ("actor_id");--> statement-breakpoint
CREATE INDEX "messaging_social_commands_actor_created_idx" ON "messaging_social_commands" ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "messaging_social_declines_pair_idx" ON "messaging_social_declines" ("low_actor_id","high_actor_id");--> statement-breakpoint
ALTER TABLE "messaging_retained_authors" ADD CONSTRAINT "messaging_retained_authors_XzNb7mYFXBhe_fkey" FOREIGN KEY ("channel_id") REFERENCES "messaging_channels"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "messaging_retained_authors" ADD CONSTRAINT "messaging_retained_authors_actor_id_actors_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "messaging_social_declines" ADD CONSTRAINT "messaging_social_declines_decliner_actor_id_actors_id_fkey" FOREIGN KEY ("decliner_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "messaging_social_declines" ADD CONSTRAINT "messaging_social_declines_requester_actor_id_actors_id_fkey" FOREIGN KEY ("requester_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "messaging_social_declines" ADD CONSTRAINT "messaging_social_declines_low_actor_id_actors_id_fkey" FOREIGN KEY ("low_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "messaging_social_declines" ADD CONSTRAINT "messaging_social_declines_high_actor_id_actors_id_fkey" FOREIGN KEY ("high_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "messaging_social_declines" ADD CONSTRAINT "messaging_social_declines_448h6tSFZspo_fkey" FOREIGN KEY ("low_actor_id","high_actor_id") REFERENCES "messaging_contact_pairs"("low_actor_id","high_actor_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "messaging_channels" DROP CONSTRAINT "messaging_channels_lifecycle", ADD CONSTRAINT "messaging_channels_lifecycle" CHECK ("lifecycle" in ('active', 'archived', 'retained'));--> statement-breakpoint
ALTER TABLE "messaging_social_commands" DROP CONSTRAINT "messaging_social_commands_kind", ADD CONSTRAINT "messaging_social_commands_kind" CHECK ("kind" in ('dm.request', 'friend.request', 'dm.decide', 'dm.block', 'group.create', 'group.invite', 'group.decide', 'group.remove', 'group.leave', 'group.transfer', 'group.archive'));