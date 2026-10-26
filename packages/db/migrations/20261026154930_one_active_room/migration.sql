CREATE TABLE "room_active_memberships" (
	"actor_id" text PRIMARY KEY,
	"room_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "room_active_memberships_room_idx" ON "room_active_memberships" ("room_id");--> statement-breakpoint
ALTER TABLE "room_active_memberships" ADD CONSTRAINT "room_active_memberships_actor_id_actors_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "room_active_memberships" ADD CONSTRAINT "room_active_memberships_room_id_rooms_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE;
--> statement-breakpoint
-- Hold the human members of every Room still open, or live with its last speech not yet ended (ADR 0070); a user several Rooms held keeps the newest.
INSERT INTO "room_active_memberships" ("actor_id", "room_id")
SELECT "member"."actor_id", "member"."room_id"
FROM (
  SELECT "rooms"."host_actor_id" AS "actor_id", "rooms"."id" AS "room_id", "rooms"."created_at" FROM "rooms"
  UNION
  SELECT "room_participants"."actor_id", "rooms"."id", "rooms"."created_at"
  FROM "room_participants"
  JOIN "rooms" ON "rooms"."id" = "room_participants"."room_id"
  JOIN "actors" ON "actors"."id" = "room_participants"."actor_id" AND "actors"."kind" = 'human'
) AS "member"
JOIN "rooms" ON "rooms"."id" = "member"."room_id"
WHERE "rooms"."status" IN ('assembling', 'ready')
  OR ("rooms"."status" = 'started' AND EXISTS (
    SELECT 1 FROM "rounds" WHERE "rounds"."room_id" = "rooms"."id" AND "rounds"."status" IN ('scheduled', 'active') AND "rounds"."final_segment_ended_at" IS NULL
  ))
ORDER BY "member"."created_at" DESC
ON CONFLICT ("actor_id") DO NOTHING;
