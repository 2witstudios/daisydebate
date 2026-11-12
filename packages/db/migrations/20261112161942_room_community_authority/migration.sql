ALTER TABLE "messaging_channels" ADD COLUMN "room_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "messaging_channels_room_kind_unique" ON "messaging_channels" ("room_id","kind");--> statement-breakpoint
ALTER TABLE "messaging_channels" ADD CONSTRAINT "messaging_channels_room_id_rooms_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "messaging_channels" ADD CONSTRAINT "messaging_channels_room" CHECK (("kind" = 'room_community') = ("room_id" is not null));--> statement-breakpoint
ALTER TABLE "messaging_channels" DROP CONSTRAINT "messaging_channels_kind", ADD CONSTRAINT "messaging_channels_kind" CHECK ("kind" in ('dm', 'private_group', 'round_floor', 'round_spectator', 'room_community'));--> statement-breakpoint
ALTER TABLE "messaging_channels" DROP CONSTRAINT "messaging_channels_policy", ADD CONSTRAINT "messaging_channels_policy" CHECK ("policy_revision" > 0 and (("kind" = 'dm' and "policy_key" = 'social.dm') or ("kind" = 'private_group' and "policy_key" = 'social.private_group') or ("kind" = 'round_floor' and "policy_key" = 'round.floor') or ("kind" = 'round_spectator' and "policy_key" = 'round.spectator') or ("kind" = 'room_community' and "policy_key" = 'room.community')));
--> statement-breakpoint
-- Room chat (ADR 0126) shares Messaging storage and never social pair/grant
-- authority. Nothing above rewrites a row: the column is new and null, and each
-- replaced CHECK admits every row the old one did.
-- SECURITY DEFINER supplies the Room fence to realtime without UPDATE grants.
-- Room commands hold the Room row FOR UPDATE, so Start and close serialize
-- with every chat read and write.
CREATE FUNCTION public.daisy_room_community_read_fence(requested_room_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $room_community_fence$
BEGIN
 PERFORM id FROM public.rooms WHERE id=requested_room_id FOR SHARE;
 RETURN FOUND;
END;
$room_community_fence$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_room_community_read_fence(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_room_community_read_fence(text) TO daisy_web, daisy_realtime;
--> statement-breakpoint
CREATE FUNCTION public.daisy_room_community_channel(requested_channel_id text)
RETURNS TABLE(room_id text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $room_community_channel$
 SELECT c.room_id FROM public.messaging_channels c WHERE c.id=requested_channel_id AND c.kind='room_community';
$room_community_channel$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_room_community_channel(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_room_community_channel(text) TO daisy_realtime;
--> statement-breakpoint
-- Only Room lifecycle, visibility and this caller's standing leave this read.
-- 'seated' is the host or any seat, with no role: a judge is not told apart.
-- 'visitor' is anyone else while the Room is one anyone may read (room.read).
-- The version moves with every Room write (command or sync), so a permit
-- granted before a change is never mistaken for a current one. A Room is not
-- written again once it has started or closed, so its last write is its end.
CREATE FUNCTION public.daisy_room_community_fact(requested_room_id text, requested_actor_id text)
RETURNS TABLE(version bigint,status text,visibility text,ended_at timestamptz,standing text,channel_id text,authority_revision bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $room_community_fact$
 SELECT r.version::bigint+r.change_version::bigint,r.status,r.visibility,
 CASE WHEN r.status IN ('assembling','ready') THEN NULL ELSE r.updated_at END,
 CASE WHEN r.host_actor_id=requested_actor_id OR p.actor_id IS NOT NULL THEN 'seated'
 WHEN r.visibility IN ('public','unlisted') THEN 'visitor' ELSE NULL END,
 c.id,c.authority_revision
 FROM public.rooms r LEFT JOIN public.room_participants p ON p.room_id=r.id AND p.actor_id=requested_actor_id
 LEFT JOIN public.messaging_channels c ON c.room_id=r.id AND c.kind='room_community'
 WHERE r.id=requested_room_id AND (c.id IS NULL OR (c.policy_revision=1 AND c.lifecycle='active'));
$room_community_fact$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_room_community_fact(text,text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_room_community_fact(text,text) TO daisy_web, daisy_realtime;
--> statement-breakpoint
CREATE FUNCTION public.daisy_room_community_channel_read_fence(requested_channel_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $room_community_channel_fence$
BEGIN
 PERFORM id FROM public.messaging_channels WHERE id=requested_channel_id AND kind='room_community' FOR SHARE;
 RETURN FOUND;
END;
$room_community_channel_fence$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_room_community_channel_read_fence(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_room_community_channel_read_fence(text) TO daisy_realtime;
--> statement-breakpoint
-- A Room chat is observable only while its Room is open; its disclosure
-- revision follows the Room, as the floor's follows its Round.
CREATE OR REPLACE FUNCTION public.daisy_observation_channel_headers(requested_channel_ids text[])
RETURNS TABLE (channel_id text, change_version bigint, authority_revision bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $observation_channel_headers$
  SELECT s.channel_id, s.change_version,
    case when c.kind='round_floor' then c.authority_revision+r.version
      when c.kind='room_community' then c.authority_revision+rm.version+rm.change_version
      else c.authority_revision end
  FROM public.messaging_channel_streams AS s
  JOIN public.messaging_channels AS c ON c.id = s.channel_id
  LEFT JOIN public.rounds r ON r.id=c.round_id
  LEFT JOIN public.rooms rm ON rm.id=c.room_id
  WHERE (c.kind<>'round_floor' OR (r.completed_at IS NULL OR clock_timestamp()<r.completed_at+interval '180 days'))
    AND (c.kind<>'room_community' OR rm.status IN ('assembling','ready'))
    AND s.channel_id = ANY (requested_channel_ids[1:1024]);
$observation_channel_headers$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.daisy_observation_channel_messages(requested_channel_id text, item_limit integer)
RETURNS TABLE (
  change_version bigint,
  authority_revision bigint,
  id text,
  author_actor_id text,
  sequence bigint,
  message_change_version bigint,
  text text,
  reply_to_message_id text,
  created_at timestamptz,
  edited_at timestamptz,
  removed_at timestamptz,
  reactions jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $observation_channel_messages$
  SELECT s.change_version,
    case when c.kind='round_floor' then c.authority_revision+r.version
      when c.kind='room_community' then c.authority_revision+rm.version+rm.change_version
      else c.authority_revision end,
    m.id, m.author_actor_id, m.sequence,
    m.change_version, m.text, m.reply_to_message_id, m.created_at, m.edited_at, m.removed_at,
    m.reactions
  FROM public.messaging_channel_streams AS s
  JOIN public.messaging_channels AS c ON c.id = s.channel_id
  LEFT JOIN public.rounds r ON r.id=c.round_id
  LEFT JOIN public.rooms rm ON rm.id=c.room_id
  LEFT JOIN LATERAL (
    SELECT mm.id, mm.author_actor_id, mm.sequence, mm.change_version, mm.text,
      mm.reply_to_message_id, mm.created_at, mm.edited_at, mm.removed_at,
      CASE WHEN mm.text IS NULL OR mm.removed_at IS NOT NULL THEN '[]'::jsonb ELSE (
        SELECT coalesce(jsonb_agg(jsonb_build_object('reaction', grouped.reaction, 'count', grouped.total)
          ORDER BY grouped.reaction), '[]'::jsonb)
        FROM (
          SELECT r.reaction, count(*)::integer AS total
          FROM public.messaging_reactions AS r
          WHERE r.channel_id = mm.channel_id AND r.message_id = mm.id
          GROUP BY r.reaction
        ) AS grouped
      ) END AS reactions
    FROM public.messaging_messages AS mm
    WHERE mm.channel_id = s.channel_id
    ORDER BY mm.sequence DESC
    LIMIT least(greatest(item_limit, 1), 100) + 1
  ) AS m ON true
  WHERE (c.kind<>'round_floor' OR (r.completed_at IS NULL OR clock_timestamp()<r.completed_at+interval '180 days'))
    AND (c.kind<>'room_community' OR rm.status IN ('assembling','ready'))
    AND s.channel_id = requested_channel_id
  ORDER BY m.sequence DESC NULLS LAST;
$observation_channel_messages$;
