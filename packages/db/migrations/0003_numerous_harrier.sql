CREATE TABLE "outbox" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"txid" "xid8" DEFAULT pg_current_xact_id() NOT NULL,
	"topic" text NOT NULL,
	"kind" text NOT NULL,
	"version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT statement_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "outbox_txid_seq_idx" ON "outbox" USING btree ("txid","seq");--> statement-breakpoint
CREATE INDEX "outbox_topic_idx" ON "outbox" USING btree ("topic");--> statement-breakpoint
CREATE INDEX "outbox_created_at_idx" ON "outbox" USING btree ("created_at");