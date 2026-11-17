-- tab_wiring added egress_settled_at with no backfill, so every pre-Tab Egress
-- read as physically unsettled: it held nonranked capture capacity and kept
-- its Broadcast in the reconciler, which asked LiveKit about an Egress long gone.
-- Pre-Tab means never dispatched under Tab's attempt protocol. Only an ended
-- logical record of an over Round is settled, at its own end; anything still
-- live is left to the reconciler. Repeating this changes nothing.
UPDATE "broadcasts" b SET "egress_settled_at" = b."completed_at"
FROM "rounds" r
WHERE r."id" = b."round_id" AND r."status" IN ('completed', 'abandoned')
  AND b."completed_at" IS NOT NULL
  AND b."egress_id" IS NOT NULL AND b."egress_dispatched_at" IS NULL
  AND b."egress_settled_at" IS NULL;
--> statement-breakpoint
UPDATE "recording_captures" c SET "egress_settled_at" = c."ended_at"
FROM "rounds" r
WHERE r."id" = c."round_id" AND r."status" IN ('completed', 'abandoned')
  AND c."ended_at" IS NOT NULL
  AND c."egress_id" IS NOT NULL AND c."egress_dispatched_at" IS NULL
  AND c."egress_settled_at" IS NULL;
