CREATE TABLE "round_private_spans" (
	"round_id" text,
	"kind" text,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	CONSTRAINT "round_private_spans_pkey" PRIMARY KEY("round_id","kind","started_at"),
	CONSTRAINT "round_private_spans_kind_check" CHECK ("kind" in ('prep', 'judging'))
);
--> statement-breakpoint
ALTER TABLE "broadcasts" DROP CONSTRAINT "broadcasts_control_lapses_is_object";--> statement-breakpoint
ALTER TABLE "recording_captures" DROP CONSTRAINT "recording_captures_control_lapses_is_object";--> statement-breakpoint
ALTER TABLE "broadcasts" DROP COLUMN "control_lapses";--> statement-breakpoint
ALTER TABLE "recording_captures" DROP COLUMN "control_lapses";--> statement-breakpoint
CREATE UNIQUE INDEX "round_private_spans_single_open" ON "round_private_spans" ("round_id","kind") WHERE "ended_at" is null;--> statement-breakpoint
ALTER TABLE "round_private_spans" ADD CONSTRAINT "round_private_spans_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
-- What the broadcast worker may read of a Round: when its speeches and private spans
-- ran. Views run as their owner, so this grants no Round table and no other column (ADR 0099).
CREATE VIEW "broadcast_public_history" AS
  SELECT b.id AS broadcast_id, s.sequence, s.started_at, s.ended_at, s.duration_ms
  FROM broadcasts b
  JOIN round_segments s ON s.round_id = b.round_id;--> statement-breakpoint
CREATE VIEW "broadcast_private_history" AS
  SELECT b.id AS broadcast_id, p.kind, p.started_at, p.ended_at
  FROM broadcasts b
  JOIN round_private_spans p ON p.round_id = b.round_id;--> statement-breakpoint
GRANT SELECT ON "broadcast_public_history" TO daisy_broadcast_worker;--> statement-breakpoint
GRANT SELECT ON "broadcast_private_history" TO daisy_broadcast_worker;
