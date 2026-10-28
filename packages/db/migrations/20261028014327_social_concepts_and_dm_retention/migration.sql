CREATE TABLE "contact_commands" (
	"actor_id" text,
	"request_id" text,
	"counterpart_actor_id" text NOT NULL,
	"kind" text NOT NULL,
	"digest" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "contact_commands_pkey" PRIMARY KEY("actor_id","request_id"),
	CONSTRAINT "contact_commands_kind" CHECK ("kind" in ('contact.block')),
	CONSTRAINT "contact_commands_digest" CHECK ("digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "social_request_declines" (
	"decliner_actor_id" text,
	"requester_actor_id" text,
	"low_actor_id" text NOT NULL,
	"high_actor_id" text NOT NULL,
	"declined_count" bigint NOT NULL,
	"last_declined_at" timestamp with time zone NOT NULL,
	"blocked_until" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "social_request_declines_pkey" PRIMARY KEY("decliner_actor_id","requester_actor_id"),
	CONSTRAINT "social_request_declines_pair" CHECK (("low_actor_id" = "decliner_actor_id" and "high_actor_id" = "requester_actor_id") or ("low_actor_id" = "requester_actor_id" and "high_actor_id" = "decliner_actor_id")),
	CONSTRAINT "social_request_declines_count" CHECK ("declined_count" between 0 and 3),
	CONSTRAINT "social_request_declines_expiry" CHECK ("expires_at" > "last_declined_at" and ("blocked_until" is null or "blocked_until" <= "expires_at"))
);
--> statement-breakpoint
CREATE TABLE "social_requests" (
	"actor_id" text,
	"request_id" text,
	"counterpart_actor_id" text NOT NULL,
	"kind" text NOT NULL,
	"unrelated" boolean NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "social_requests_pkey" PRIMARY KEY("actor_id","request_id"),
	CONSTRAINT "social_requests_kind" CHECK ("kind" in ('dm', 'friend')),
	CONSTRAINT "social_requests_distinct" CHECK ("actor_id" <> "counterpart_actor_id")
);
--> statement-breakpoint
CREATE TABLE "messaging_retained_authors" (
	"channel_id" text,
	"actor_id" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "messaging_retained_authors_pkey" PRIMARY KEY("channel_id","actor_id")
);
--> statement-breakpoint
ALTER TABLE "messaging_contact_pairs" RENAME TO "contact_pairs";--> statement-breakpoint
ALTER TABLE "messaging_friend_challenges" RENAME TO "friend_challenges";--> statement-breakpoint
ALTER TABLE "messaging_friendships" RENAME TO "friendships";--> statement-breakpoint
ALTER TABLE "messaging_presence_settings" RENAME TO "presence_settings";--> statement-breakpoint
ALTER TABLE "contact_pairs" RENAME CONSTRAINT "messaging_contact_pairs_order" TO "contact_pairs_order";--> statement-breakpoint
ALTER TABLE "contact_pairs" RENAME CONSTRAINT "messaging_contact_pairs_revision" TO "contact_pairs_revision";--> statement-breakpoint
ALTER TABLE "friend_challenges" RENAME CONSTRAINT "messaging_friend_challenges_distinct" TO "friend_challenges_distinct";--> statement-breakpoint
ALTER TABLE "friendships" RENAME CONSTRAINT "messaging_friendships_order" TO "friendships_order";--> statement-breakpoint
ALTER TABLE "friendships" RENAME CONSTRAINT "messaging_friendships_requester" TO "friendships_requester";--> statement-breakpoint
ALTER TABLE "friendships" RENAME CONSTRAINT "messaging_friendships_state" TO "friendships_state";--> statement-breakpoint
ALTER TABLE "friendships" RENAME CONSTRAINT "messaging_friendships_time" TO "friendships_time";--> statement-breakpoint
ALTER INDEX "messaging_contact_pairs_high_actor_idx" RENAME TO "contact_pairs_high_actor_idx";--> statement-breakpoint
ALTER INDEX "messaging_friend_challenges_challenged_idx" RENAME TO "friend_challenges_challenged_idx";--> statement-breakpoint
ALTER INDEX "messaging_friend_challenges_challenger_idx" RENAME TO "friend_challenges_challenger_idx";--> statement-breakpoint
ALTER INDEX "messaging_friendships_high_actor_idx" RENAME TO "friendships_high_actor_idx";--> statement-breakpoint
ALTER TABLE "friendships" RENAME CONSTRAINT "messaging_friendships_contact_fk" TO "friendships_contact_fk";--> statement-breakpoint
-- Primary and foreign keys take their concept's table name too.
ALTER TABLE "contact_pairs" RENAME CONSTRAINT "messaging_contact_pairs_high_actor_id_actors_id_fkey" TO "contact_pairs_high_actor_id_actors_id_fkey";--> statement-breakpoint
ALTER TABLE "contact_pairs" RENAME CONSTRAINT "messaging_contact_pairs_low_actor_id_actors_id_fkey" TO "contact_pairs_low_actor_id_actors_id_fkey";--> statement-breakpoint
ALTER TABLE "contact_pairs" RENAME CONSTRAINT "messaging_contact_pairs_pkey" TO "contact_pairs_pkey";--> statement-breakpoint
ALTER TABLE "friend_challenges" RENAME CONSTRAINT "messaging_friend_challenges_challenged_actor_id_actors_id_fkey" TO "friend_challenges_challenged_actor_id_actors_id_fkey";--> statement-breakpoint
ALTER TABLE "friend_challenges" RENAME CONSTRAINT "messaging_friend_challenges_challenger_actor_id_actors_id_fkey" TO "friend_challenges_challenger_actor_id_actors_id_fkey";--> statement-breakpoint
ALTER TABLE "friend_challenges" RENAME CONSTRAINT "messaging_friend_challenges_pkey" TO "friend_challenges_pkey";--> statement-breakpoint
ALTER TABLE "friend_challenges" RENAME CONSTRAINT "messaging_friend_challenges_room_id_rooms_id_fkey" TO "friend_challenges_room_id_rooms_id_fkey";--> statement-breakpoint
ALTER TABLE "friendships" RENAME CONSTRAINT "messaging_friendships_high_actor_id_actors_id_fkey" TO "friendships_high_actor_id_actors_id_fkey";--> statement-breakpoint
ALTER TABLE "friendships" RENAME CONSTRAINT "messaging_friendships_low_actor_id_actors_id_fkey" TO "friendships_low_actor_id_actors_id_fkey";--> statement-breakpoint
ALTER TABLE "friendships" RENAME CONSTRAINT "messaging_friendships_pkey" TO "friendships_pkey";--> statement-breakpoint
ALTER TABLE "presence_settings" RENAME CONSTRAINT "messaging_presence_settings_actor_id_actors_id_fkey" TO "presence_settings_actor_id_actors_id_fkey";--> statement-breakpoint
ALTER TABLE "presence_settings" RENAME CONSTRAINT "messaging_presence_settings_pkey" TO "presence_settings_pkey";--> statement-breakpoint
CREATE INDEX "contact_commands_counterpart_actor_idx" ON "contact_commands" ("counterpart_actor_id");--> statement-breakpoint
CREATE INDEX "social_request_declines_pair_idx" ON "social_request_declines" ("low_actor_id","high_actor_id");--> statement-breakpoint
CREATE INDEX "social_request_declines_requester_idx" ON "social_request_declines" ("requester_actor_id");--> statement-breakpoint
CREATE INDEX "social_request_declines_high_actor_idx" ON "social_request_declines" ("high_actor_id");--> statement-breakpoint
CREATE INDEX "social_request_declines_expires_idx" ON "social_request_declines" ("expires_at");--> statement-breakpoint
CREATE INDEX "social_requests_actor_created_idx" ON "social_requests" ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "social_requests_counterpart_actor_idx" ON "social_requests" ("counterpart_actor_id");--> statement-breakpoint
CREATE INDEX "social_requests_created_idx" ON "social_requests" ("created_at");--> statement-breakpoint
CREATE INDEX "messaging_retained_authors_actor_idx" ON "messaging_retained_authors" ("actor_id");--> statement-breakpoint
ALTER TABLE "contact_commands" ADD CONSTRAINT "contact_commands_actor_id_actors_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "contact_commands" ADD CONSTRAINT "contact_commands_counterpart_actor_id_actors_id_fkey" FOREIGN KEY ("counterpart_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "social_request_declines" ADD CONSTRAINT "social_request_declines_decliner_actor_id_actors_id_fkey" FOREIGN KEY ("decliner_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "social_request_declines" ADD CONSTRAINT "social_request_declines_requester_actor_id_actors_id_fkey" FOREIGN KEY ("requester_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "social_request_declines" ADD CONSTRAINT "social_request_declines_low_actor_id_actors_id_fkey" FOREIGN KEY ("low_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "social_request_declines" ADD CONSTRAINT "social_request_declines_high_actor_id_actors_id_fkey" FOREIGN KEY ("high_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "social_request_declines" ADD CONSTRAINT "social_request_declines_XyTEC649xO1O_fkey" FOREIGN KEY ("low_actor_id","high_actor_id") REFERENCES "contact_pairs"("low_actor_id","high_actor_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "social_requests" ADD CONSTRAINT "social_requests_actor_id_actors_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "social_requests" ADD CONSTRAINT "social_requests_counterpart_actor_id_actors_id_fkey" FOREIGN KEY ("counterpart_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "messaging_retained_authors" ADD CONSTRAINT "messaging_retained_authors_XzNb7mYFXBhe_fkey" FOREIGN KEY ("channel_id") REFERENCES "messaging_channels"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "messaging_retained_authors" ADD CONSTRAINT "messaging_retained_authors_actor_id_actors_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "messaging_channels" DROP CONSTRAINT "messaging_channels_lifecycle", ADD CONSTRAINT "messaging_channels_lifecycle" CHECK ("lifecycle" in ('active', 'archived', 'retained'));--> statement-breakpoint
-- DEC-251's request budget moves to Contacts: existing DM requests carry over (unrelated was never recorded, so false).
INSERT INTO "social_requests" ("actor_id","request_id","counterpart_actor_id","kind","unrelated","created_at")
SELECT "actor_id","request_id","counterpart_actor_id",'dm',false,"created_at"
FROM "messaging_social_commands"
WHERE "kind" = 'dm.request' AND "counterpart_actor_id" IS NOT NULL AND "counterpart_actor_id" <> "actor_id";--> statement-breakpoint
-- A block is a Contacts command (S6). Pre-ship (ADR 0023), its old receipts
-- are not carried: a retried block simply applies again.
DELETE FROM "messaging_social_commands" WHERE "kind" = 'dm.block';--> statement-breakpoint
ALTER TABLE "messaging_social_commands" DROP CONSTRAINT "messaging_social_commands_kind", ADD CONSTRAINT "messaging_social_commands_kind" CHECK ("kind" in ('dm.request', 'dm.decide', 'group.create', 'group.invite', 'group.decide', 'group.remove', 'group.leave', 'group.transfer', 'group.archive'));--> statement-breakpoint
-- The channel fence names the renamed contact pair table (plpgsql resolves names when it runs).
CREATE OR REPLACE FUNCTION public.daisy_messaging_channel_fence(
  requested_channel_id text, expected_low_actor_id text, expected_high_actor_id text
) RETURNS boolean
LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $messaging_channel_fence$
DECLARE
  channel_kind text;
  actual_low_actor_id text;
  actual_high_actor_id text;
BEGIN
  IF requested_channel_id IS NULL OR requested_channel_id !~ '^[a-z0-9]{24}$'
    OR (expected_low_actor_id IS NULL) <> (expected_high_actor_id IS NULL)
    OR (expected_low_actor_id IS NOT NULL AND (
      expected_low_actor_id !~ '^[a-z0-9]{24}$' OR expected_high_actor_id !~ '^[a-z0-9]{24}$'
      OR expected_low_actor_id >= expected_high_actor_id
    )) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid messaging fence selector';
  END IF;
  SELECT c.kind, d.low_actor_id, d.high_actor_id
    INTO channel_kind, actual_low_actor_id, actual_high_actor_id
    FROM public.messaging_channels AS c
    LEFT JOIN public.messaging_dm_pairs AS d ON d.channel_id = c.id
    WHERE c.id = requested_channel_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF channel_kind = 'dm' THEN
    IF actual_low_actor_id IS NULL OR actual_high_actor_id IS NULL
      OR actual_low_actor_id IS DISTINCT FROM expected_low_actor_id
      OR actual_high_actor_id IS DISTINCT FROM expected_high_actor_id
    THEN RETURN false; END IF;
    -- Canonical account locks are already held by the same caller transaction.
    PERFORM p.low_actor_id FROM public.contact_pairs AS p
      WHERE p.low_actor_id = actual_low_actor_id AND p.high_actor_id = actual_high_actor_id
      FOR UPDATE OF p;
    IF NOT FOUND THEN RETURN false; END IF;
  ELSIF channel_kind <> 'private_group' OR expected_low_actor_id IS NOT NULL THEN
    RETURN false;
  END IF;
  PERFORM c.id FROM public.messaging_channels AS c
    WHERE c.id = requested_channel_id FOR UPDATE OF c;
  RETURN FOUND;
END;
$messaging_channel_fence$;--> statement-breakpoint
-- The shared read fence (#484) names the renamed contact pair table too.
CREATE OR REPLACE FUNCTION public.daisy_messaging_channel_read_fence(
  requested_channel_id text, expected_low_actor_id text, expected_high_actor_id text
) RETURNS boolean
LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $messaging_channel_read_fence$
DECLARE
  channel_kind text;
  actual_low_actor_id text;
  actual_high_actor_id text;
BEGIN
  IF requested_channel_id IS NULL OR requested_channel_id !~ '^[a-z0-9]{24}$'
    OR (expected_low_actor_id IS NULL) <> (expected_high_actor_id IS NULL)
    OR (expected_low_actor_id IS NOT NULL AND (
      expected_low_actor_id !~ '^[a-z0-9]{24}$' OR expected_high_actor_id !~ '^[a-z0-9]{24}$'
      OR expected_low_actor_id >= expected_high_actor_id
    )) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid messaging fence selector';
  END IF;
  SELECT c.kind, d.low_actor_id, d.high_actor_id
    INTO channel_kind, actual_low_actor_id, actual_high_actor_id
    FROM public.messaging_channels AS c
    LEFT JOIN public.messaging_dm_pairs AS d ON d.channel_id = c.id
    WHERE c.id = requested_channel_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF channel_kind = 'dm' THEN
    IF actual_low_actor_id IS NULL OR actual_high_actor_id IS NULL
      OR actual_low_actor_id IS DISTINCT FROM expected_low_actor_id
      OR actual_high_actor_id IS DISTINCT FROM expected_high_actor_id
    THEN RETURN false; END IF;
    PERFORM p.low_actor_id FROM public.contact_pairs AS p
      WHERE p.low_actor_id = actual_low_actor_id AND p.high_actor_id = actual_high_actor_id
      FOR SHARE OF p;
    IF NOT FOUND THEN RETURN false; END IF;
  ELSIF channel_kind <> 'private_group' OR expected_low_actor_id IS NOT NULL THEN
    RETURN false;
  END IF;
  PERFORM c.id FROM public.messaging_channels AS c
    WHERE c.id = requested_channel_id FOR SHARE OF c;
  RETURN FOUND;
END;
$messaging_channel_read_fence$;
