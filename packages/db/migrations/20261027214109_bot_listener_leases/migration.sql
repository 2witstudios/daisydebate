CREATE TABLE "bot_listener_leases" (
	"session_id" text PRIMARY KEY,
	"worker_id" text NOT NULL,
	"epoch" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "bot_listener_leases_epoch_check" CHECK ("epoch" > 0)
);
--> statement-breakpoint
ALTER TABLE "bot_listener_leases" ADD CONSTRAINT "bot_listener_leases_session_id_media_sessions_id_fkey" FOREIGN KEY ("session_id") REFERENCES "media_sessions"("id") ON DELETE CASCADE;