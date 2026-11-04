ALTER TABLE "broadcasts" ADD COLUMN "audience_state_withdrawn_at" timestamp with time zone;--> statement-breakpoint
-- daisy_audience_publisher: reads released public facts to publish a Round's state
-- to the public bucket (DEC-350). Read only, but for the one column saying that state
-- is gone. The hold worker's role stays apart and still reads no Round (ADR 0099).
-- No password here: staging and production provision the credential out of band.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'daisy_audience_publisher') THEN
    CREATE ROLE daisy_audience_publisher LOGIN;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO daisy_audience_publisher;
--> statement-breakpoint
GRANT SELECT ON broadcasts, rounds, round_participants, actors, bot_profiles, recordings, recording_processing_jobs, round_segments, rating_changes, audience_reactions TO daisy_audience_publisher;
--> statement-breakpoint
GRANT SELECT (id, round_id, winner, scores, reason) ON ballots TO daisy_audience_publisher;
--> statement-breakpoint
GRANT SELECT (id, round_id, round_participant_id, segment_id, complete, created_at, text) ON utterances TO daisy_audience_publisher;
--> statement-breakpoint
-- A Round's spectator chat and nothing else of messaging: this login never reaches a DM
-- or a private group. Views run as their owner, so it holds no messaging table (ADR 0112).
CREATE VIEW "spectator_chat_messages" AS
  SELECT c.round_id, m.id, m.sequence, m.text, m.author_actor_id, m.created_at
  FROM messaging_channels c
  JOIN messaging_messages m ON m.channel_id = c.id
  WHERE c.kind = 'round_spectator';
--> statement-breakpoint
GRANT SELECT ON "spectator_chat_messages" TO daisy_audience_publisher, daisy_web;
--> statement-breakpoint
GRANT SELECT (id, username, deleted_at) ON users TO daisy_audience_publisher;
--> statement-breakpoint
GRANT UPDATE (audience_state_withdrawn_at) ON broadcasts TO daisy_audience_publisher;
--> statement-breakpoint
-- The hold worker's reads name every column it may see, so it may see this one; it says
-- only that a Broadcast's published state is gone.
GRANT SELECT (audience_state_withdrawn_at) ON broadcasts TO daisy_broadcast_worker;
