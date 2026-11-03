ALTER TABLE "broadcasts" ADD COLUMN "control_heartbeat_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD COLUMN "control_lapses" jsonb DEFAULT '{"lapses":[]}' NOT NULL;--> statement-breakpoint
ALTER TABLE "recording_captures" ADD COLUMN "control_heartbeat_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "recording_captures" ADD COLUMN "control_lapses" jsonb DEFAULT '{"lapses":[]}' NOT NULL;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_control_lapses_is_object" CHECK (jsonb_typeof("control_lapses") = 'object');--> statement-breakpoint
ALTER TABLE "recording_captures" ADD CONSTRAINT "recording_captures_control_lapses_is_object" CHECK (jsonb_typeof("control_lapses") = 'object');