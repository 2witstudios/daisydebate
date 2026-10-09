CREATE TABLE "messaging_actor_states" (
	"channel_id" text,
	"actor_id" text,
	"following" boolean NOT NULL,
	"hidden" boolean NOT NULL,
	"notification_level" text NOT NULL,
	"read_sequence" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "messaging_actor_states_pkey" PRIMARY KEY("channel_id","actor_id"),
	CONSTRAINT "messaging_actor_states_notification" CHECK ("notification_level" in ('all', 'mentions', 'none')),
	CONSTRAINT "messaging_actor_states_read" CHECK ("read_sequence" between 0 and 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE "messaging_channels" (
	"id" text PRIMARY KEY,
	"kind" text NOT NULL,
	"policy_key" text NOT NULL,
	"policy_revision" integer NOT NULL,
	"lifecycle" text NOT NULL,
	"title" text,
	"message_sequence" bigint DEFAULT 0 NOT NULL,
	"change_version" bigint DEFAULT 0 NOT NULL,
	"authority_revision" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messaging_channels_id_kind_unique" UNIQUE("id","kind"),
	CONSTRAINT "messaging_channels_kind" CHECK ("kind" in ('dm', 'private_group')),
	CONSTRAINT "messaging_channels_lifecycle" CHECK ("lifecycle" in ('active', 'archived')),
	CONSTRAINT "messaging_channels_policy" CHECK ("policy_revision" > 0 and (("kind" = 'dm' and "policy_key" = 'social.dm') or ("kind" = 'private_group' and "policy_key" = 'social.private_group'))),
	CONSTRAINT "messaging_channels_counters" CHECK ("message_sequence" between 0 and 9007199254740991 and "change_version" between "message_sequence" and 9007199254740991),
	CONSTRAINT "messaging_channels_authority_revision" CHECK ("authority_revision" between 1 and 9007199254740991),
	CONSTRAINT "messaging_channels_title" CHECK (("kind" = 'dm' and "title" is null) or ("kind" = 'private_group' and "title" is not null and "title" ~ '[^[:space:]]'))
);
--> statement-breakpoint
CREATE TABLE "messaging_messages" (
	"id" text PRIMARY KEY,
	"channel_id" text NOT NULL,
	"author_actor_id" text NOT NULL,
	"sequence" bigint NOT NULL,
	"change_version" bigint NOT NULL,
	"text" text,
	"reply_to_message_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"edited_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	CONSTRAINT "messaging_messages_id_channel_unique" UNIQUE("id","channel_id"),
	CONSTRAINT "messaging_messages_sequence_unique" UNIQUE("channel_id","sequence"),
	CONSTRAINT "messaging_messages_order" CHECK ("sequence" between 1 and 9007199254740991 and "change_version" between "sequence" and 9007199254740991),
	CONSTRAINT "messaging_messages_content" CHECK (("removed_at" is null and "text" is not null and "text" ~ '[^[:space:]]') or ("removed_at" is not null and "text" is null)),
	CONSTRAINT "messaging_messages_times" CHECK (("edited_at" is null or "edited_at" >= "created_at") and ("removed_at" is null or "removed_at" >= "created_at"))
);
--> statement-breakpoint
CREATE TABLE "messaging_reactions" (
	"channel_id" text NOT NULL,
	"message_id" text,
	"actor_id" text,
	"reaction" text,
	CONSTRAINT "messaging_reactions_pkey" PRIMARY KEY("message_id","actor_id","reaction"),
	CONSTRAINT "messaging_reactions_nonempty" CHECK ("reaction" ~ '[^[:space:]]')
);
--> statement-breakpoint
CREATE TABLE "messaging_receipts" (
	"channel_id" text,
	"actor_id" text,
	"request_id" text,
	"payload_digest" text NOT NULL,
	"message_id" text,
	CONSTRAINT "messaging_receipts_pkey" PRIMARY KEY("actor_id","channel_id","request_id"),
	CONSTRAINT "messaging_receipts_digest" CHECK ("payload_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "messaging_contact_pairs" (
	"low_actor_id" text,
	"high_actor_id" text,
	"low_blocks_high" boolean DEFAULT false NOT NULL,
	"high_blocks_low" boolean DEFAULT false NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "messaging_contact_pairs_pkey" PRIMARY KEY("low_actor_id","high_actor_id"),
	CONSTRAINT "messaging_contact_pairs_order" CHECK ("low_actor_id" < "high_actor_id"),
	CONSTRAINT "messaging_contact_pairs_revision" CHECK ("revision" between 1 and 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE "messaging_dm_pairs" (
	"low_actor_id" text,
	"high_actor_id" text,
	"channel_id" text NOT NULL CONSTRAINT "messaging_dm_pairs_channel_unique" UNIQUE,
	"channel_kind" text DEFAULT 'dm' NOT NULL,
	"request_sender_actor_id" text NOT NULL,
	"request_state" text NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "messaging_dm_pairs_pkey" PRIMARY KEY("low_actor_id","high_actor_id"),
	CONSTRAINT "messaging_dm_pairs_order" CHECK ("low_actor_id" < "high_actor_id"),
	CONSTRAINT "messaging_dm_pairs_kind" CHECK ("channel_kind" = 'dm'),
	CONSTRAINT "messaging_dm_pairs_request_sender" CHECK ("request_sender_actor_id" in ("low_actor_id", "high_actor_id")),
	CONSTRAINT "messaging_dm_pairs_request_state" CHECK ("request_state" in ('pending', 'accepted', 'declined', 'cancelled')),
	CONSTRAINT "messaging_dm_pairs_request_time" CHECK (("request_state" = 'pending' and "decided_at" is null) or ("request_state" <> 'pending' and "decided_at" is not null and "decided_at" >= "requested_at"))
);
--> statement-breakpoint
CREATE TABLE "messaging_group_grants" (
	"channel_id" text,
	"channel_kind" text DEFAULT 'private_group' NOT NULL,
	"actor_id" text,
	"role" text NOT NULL,
	"generation" bigint NOT NULL,
	"granted_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "messaging_group_grants_pkey" PRIMARY KEY("channel_id","actor_id"),
	CONSTRAINT "messaging_group_grants_kind" CHECK ("channel_kind" = 'private_group'),
	CONSTRAINT "messaging_group_grants_role" CHECK ("role" in ('manager', 'member')),
	CONSTRAINT "messaging_group_grants_time" CHECK ("revoked_at" is null or "revoked_at" >= "granted_at"),
	CONSTRAINT "messaging_group_grants_generation" CHECK ("generation" between 1 and 9007199254740991)
);
--> statement-breakpoint
ALTER TABLE "messaging_actor_states" ADD CONSTRAINT "messaging_actor_states_channel_id_messaging_channels_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "messaging_channels"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "messaging_actor_states" ADD CONSTRAINT "messaging_actor_states_actor_id_actors_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "messaging_messages" ADD CONSTRAINT "messaging_messages_channel_id_messaging_channels_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "messaging_channels"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "messaging_messages" ADD CONSTRAINT "messaging_messages_author_actor_id_actors_id_fkey" FOREIGN KEY ("author_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "messaging_messages" ADD CONSTRAINT "messaging_messages_reply_channel_fk" FOREIGN KEY ("reply_to_message_id","channel_id") REFERENCES "messaging_messages"("id","channel_id");--> statement-breakpoint
ALTER TABLE "messaging_reactions" ADD CONSTRAINT "messaging_reactions_actor_id_actors_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "messaging_reactions" ADD CONSTRAINT "messaging_reactions_message_channel_fk" FOREIGN KEY ("message_id","channel_id") REFERENCES "messaging_messages"("id","channel_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "messaging_receipts" ADD CONSTRAINT "messaging_receipts_channel_id_messaging_channels_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "messaging_channels"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "messaging_receipts" ADD CONSTRAINT "messaging_receipts_actor_id_actors_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "messaging_receipts" ADD CONSTRAINT "messaging_receipts_message_channel_fk" FOREIGN KEY ("message_id","channel_id") REFERENCES "messaging_messages"("id","channel_id");--> statement-breakpoint
ALTER TABLE "messaging_contact_pairs" ADD CONSTRAINT "messaging_contact_pairs_low_actor_id_actors_id_fkey" FOREIGN KEY ("low_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "messaging_contact_pairs" ADD CONSTRAINT "messaging_contact_pairs_high_actor_id_actors_id_fkey" FOREIGN KEY ("high_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "messaging_dm_pairs" ADD CONSTRAINT "messaging_dm_pairs_low_actor_id_actors_id_fkey" FOREIGN KEY ("low_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "messaging_dm_pairs" ADD CONSTRAINT "messaging_dm_pairs_high_actor_id_actors_id_fkey" FOREIGN KEY ("high_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "messaging_dm_pairs" ADD CONSTRAINT "messaging_dm_pairs_contact_fk" FOREIGN KEY ("low_actor_id","high_actor_id") REFERENCES "messaging_contact_pairs"("low_actor_id","high_actor_id");--> statement-breakpoint
ALTER TABLE "messaging_dm_pairs" ADD CONSTRAINT "messaging_dm_pairs_channel_kind_fk" FOREIGN KEY ("channel_id","channel_kind") REFERENCES "messaging_channels"("id","kind") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "messaging_group_grants" ADD CONSTRAINT "messaging_group_grants_actor_id_actors_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "messaging_group_grants" ADD CONSTRAINT "messaging_group_grants_channel_kind_fk" FOREIGN KEY ("channel_id","channel_kind") REFERENCES "messaging_channels"("id","kind") ON DELETE CASCADE;