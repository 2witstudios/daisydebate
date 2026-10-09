CREATE TABLE "messaging_group_invitations" (
	"channel_id" text,
	"channel_kind" text DEFAULT 'private_group' NOT NULL,
	"invitee_actor_id" text,
	"invited_by_actor_id" text NOT NULL,
	"generation" bigint NOT NULL,
	"state" text NOT NULL,
	"invited_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "messaging_group_invitations_pkey" PRIMARY KEY("channel_id","invitee_actor_id"),
	CONSTRAINT "messaging_group_invitations_kind" CHECK ("channel_kind" = 'private_group'),
	CONSTRAINT "messaging_group_invitations_generation" CHECK ("generation" between 1 and 9007199254740991),
	CONSTRAINT "messaging_group_invitations_state" CHECK ("state" in ('pending', 'accepted', 'declined', 'cancelled')),
	CONSTRAINT "messaging_group_invitations_time" CHECK (("state" = 'pending' and "decided_at" is null) or ("state" <> 'pending' and "decided_at" >= "invited_at" and "decided_at" is not null)),
	CONSTRAINT "messaging_group_invitations_distinct" CHECK ("invitee_actor_id" <> "invited_by_actor_id")
);
--> statement-breakpoint
CREATE TABLE "messaging_social_commands" (
	"actor_id" text,
	"request_id" text,
	"kind" text NOT NULL,
	"digest" text,
	"result_channel_id" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "messaging_social_commands_pkey" PRIMARY KEY("actor_id","request_id"),
	CONSTRAINT "messaging_social_commands_digest" CHECK ("digest" is null or "digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "messaging_social_commands_kind" CHECK ("kind" in ('dm.request', 'dm.decide', 'dm.block', 'group.create', 'group.invite', 'group.decide', 'group.remove', 'group.leave', 'group.transfer', 'group.archive'))
);
--> statement-breakpoint
ALTER TABLE "messaging_dm_pairs" ADD COLUMN "introduction" text;--> statement-breakpoint
ALTER TABLE "messaging_receipts" ALTER COLUMN "payload_digest" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "messaging_group_invitations" ADD CONSTRAINT "messaging_group_invitations_invitee_actor_id_actors_id_fkey" FOREIGN KEY ("invitee_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "messaging_group_invitations" ADD CONSTRAINT "messaging_group_invitations_invited_by_actor_id_actors_id_fkey" FOREIGN KEY ("invited_by_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "messaging_group_invitations" ADD CONSTRAINT "messaging_group_invitations_channel_kind_fk" FOREIGN KEY ("channel_id","channel_kind") REFERENCES "messaging_channels"("id","kind") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "messaging_social_commands" ADD CONSTRAINT "messaging_social_commands_actor_id_actors_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "messaging_social_commands" ADD CONSTRAINT "messaging_social_commands_vwbzSiXgJWN7_fkey" FOREIGN KEY ("result_channel_id") REFERENCES "messaging_channels"("id") ON DELETE SET NULL;