-- Delay in seconds is the one release a Broadcast has. A choice of the Round's end or a
-- set time stored before this holds at the longest delay, so nothing leaves earlier than
-- its host chose. Pre-ship: only test rows can hold one.
UPDATE "broadcasts" SET "release_policy" = '{"kind":"delay","seconds":86400}'::jsonb
  WHERE "release_policy"->>'kind' <> 'delay';--> statement-breakpoint
UPDATE "rooms" SET "capture" = jsonb_set("capture", '{broadcast,release}', '{"kind":"delay","seconds":86400}'::jsonb)
  WHERE "capture"->'broadcast'->'release'->>'kind' <> 'delay';--> statement-breakpoint
UPDATE "rounds" SET "capture" = jsonb_set("capture", '{broadcast,release}', '{"kind":"delay","seconds":86400}'::jsonb)
  WHERE "capture"->'broadcast'->'release'->>'kind' <> 'delay';--> statement-breakpoint
SET CONSTRAINTS ALL IMMEDIATE;--> statement-breakpoint
ALTER TABLE "broadcasts" DROP CONSTRAINT "broadcasts_release_policy_check", ADD CONSTRAINT "broadcasts_release_policy_check" CHECK ("release_policy"->>'kind' = 'delay');
--> statement-breakpoint
-- Whether a Recording will clear a Broadcast's hold, for the worker that would otherwise
-- clear it. The view runs as its owner, so this grants no Recording table (ADR 0099).
CREATE VIEW "broadcast_recording_claims" AS
  SELECT b.id AS broadcast_id
  FROM broadcasts b
  JOIN recordings r ON r.round_id = b.round_id;--> statement-breakpoint
GRANT SELECT ON "broadcast_recording_claims" TO daisy_broadcast_worker;
