CREATE TABLE "messaging_files" (
	"id" text PRIMARY KEY,
	"channel_id" text NOT NULL,
	"owner_actor_id" text NOT NULL,
	"request_id" text,
	"message_id" text,
	"object_key" text NOT NULL CONSTRAINT "messaging_files_object_unique" UNIQUE,
	"filename" text,
	"mime" text,
	"reserved_bytes" bigint NOT NULL,
	"stored_bytes" bigint,
	"generation" bigint NOT NULL,
	"authority_revision" bigint NOT NULL,
	"lifecycle" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "messaging_files_request_unique" UNIQUE("owner_actor_id","channel_id","request_id"),
	CONSTRAINT "messaging_files_lifecycle" CHECK ("lifecycle" in ('reserved', 'quarantined', 'attached', 'deleting', 'deleted')),
	CONSTRAINT "messaging_files_bytes" CHECK ("reserved_bytes" between 1 and 9007199254740991 and ("stored_bytes" is null or "stored_bytes" between 1 and "reserved_bytes")),
	CONSTRAINT "messaging_files_generation" CHECK ("generation" between 1 and 9007199254740991 and "authority_revision" between 1 and 9007199254740991),
	CONSTRAINT "messaging_files_times" CHECK ("expires_at" > "created_at" and ("deleted_at" is null or "deleted_at" >= "created_at")),
	CONSTRAINT "messaging_files_metadata" CHECK (("lifecycle" in ('reserved','quarantined','attached') and "filename" is not null and "filename" ~ '[^[:space:]]' and "mime" in ('image/png','image/jpeg','image/webp','application/pdf') and "request_id" is not null and "deleted_at" is null) or ("lifecycle" in ('deleting','deleted') and "filename" is null and "mime" is null and "request_id" is null and "message_id" is null)),
	CONSTRAINT "messaging_files_association" CHECK (("lifecycle" = 'attached' and "message_id" is not null and "stored_bytes" is not null) or ("lifecycle" <> 'attached' and "message_id" is null)),
	CONSTRAINT "messaging_files_ack" CHECK (("lifecycle" = 'deleted') = ("deleted_at" is not null))
);
--> statement-breakpoint
CREATE INDEX "messaging_files_owner_idx" ON "messaging_files" ("owner_actor_id");--> statement-breakpoint
CREATE INDEX "messaging_files_channel_idx" ON "messaging_files" ("channel_id");--> statement-breakpoint
CREATE INDEX "messaging_files_message_idx" ON "messaging_files" ("message_id","channel_id");--> statement-breakpoint
CREATE INDEX "messaging_files_cleanup_idx" ON "messaging_files" ("lifecycle","expires_at");--> statement-breakpoint
ALTER TABLE "messaging_files" ADD CONSTRAINT "messaging_files_channel_id_messaging_channels_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "messaging_channels"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "messaging_files" ADD CONSTRAINT "messaging_files_owner_actor_id_actors_id_fkey" FOREIGN KEY ("owner_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "messaging_files" ADD CONSTRAINT "messaging_files_message_channel_fk" FOREIGN KEY ("message_id","channel_id") REFERENCES "messaging_messages"("id","channel_id");