ALTER TABLE "media_sessions" ADD COLUMN "room_retired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "platform_ending" text;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_platform_ending_check" CHECK ("platform_ending" is null or "platform_ending" in ('recovery_bound', 'capture_shortfall'));--> statement-breakpoint
ALTER TABLE "round_incidents" DROP CONSTRAINT "round_incidents_cause_check", ADD CONSTRAINT "round_incidents_cause_check" CHECK ("cause" in ('vendor_unreachable', 'room_retired'));