CREATE TABLE "email_delivery" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_message_id" text NOT NULL,
	"recipient_hash" text NOT NULL,
	"status" text NOT NULL,
	"status_rank" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_delivery_event" (
	"provider_event_id" text PRIMARY KEY NOT NULL,
	"provider_message_id" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_suppression" (
	"recipient_hash" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"provider_message_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "email_delivery_provider_message_unique" ON "email_delivery" USING btree ("provider_message_id");--> statement-breakpoint
CREATE INDEX "email_delivery_recipient_idx" ON "email_delivery" USING btree ("recipient_hash");--> statement-breakpoint
CREATE INDEX "email_delivery_event_received_idx" ON "email_delivery_event" USING btree ("received_at");