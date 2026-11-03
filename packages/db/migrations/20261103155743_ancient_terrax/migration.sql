ALTER TABLE "broadcasts" DROP CONSTRAINT "broadcasts_control_lapses_is_object";--> statement-breakpoint
ALTER TABLE "recording_captures" DROP CONSTRAINT "recording_captures_control_lapses_is_object";--> statement-breakpoint
ALTER TABLE "broadcasts" DROP COLUMN "control_lapses";--> statement-breakpoint
ALTER TABLE "recording_captures" DROP COLUMN "control_lapses";--> statement-breakpoint
-- What the broadcast worker may read of a Round: when its public intervals ran. The
-- view runs as its owner, so this grants no Round table and no other column (ADR 0099).
CREATE VIEW "broadcast_public_history" AS
  SELECT b.id AS broadcast_id, s.sequence, s.started_at, s.ended_at, s.duration_ms
  FROM broadcasts b
  JOIN round_segments s ON s.round_id = b.round_id;--> statement-breakpoint
GRANT SELECT ON "broadcast_public_history" TO daisy_broadcast_worker;
