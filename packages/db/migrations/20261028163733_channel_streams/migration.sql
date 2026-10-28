-- MSG-2.2-arch1: the channel stream (message_sequence, change_version) leaves the channel authority row.
CREATE TABLE "messaging_channel_streams" (
	"channel_id" text PRIMARY KEY,
	"message_sequence" bigint DEFAULT 0 NOT NULL,
	"change_version" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "messaging_channel_streams_counters" CHECK ("message_sequence" between 0 and 9007199254740991 and "change_version" between "message_sequence" and 9007199254740991)
);
--> statement-breakpoint
ALTER TABLE "messaging_channel_streams" ADD CONSTRAINT "messaging_channel_streams_channel_id_messaging_channels_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "messaging_channels"("id") ON DELETE CASCADE;--> statement-breakpoint
INSERT INTO "messaging_channel_streams" ("channel_id", "message_sequence", "change_version")
  SELECT "id", "message_sequence", "change_version" FROM "messaging_channels";--> statement-breakpoint
ALTER TABLE "messaging_channels" DROP CONSTRAINT "messaging_channels_counters";--> statement-breakpoint
ALTER TABLE "messaging_channels" DROP COLUMN "message_sequence";--> statement-breakpoint
ALTER TABLE "messaging_channels" DROP COLUMN "change_version";
