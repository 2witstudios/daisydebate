-- A Room belongs to the lobby it was created in (ADR 0156): Open or Youth,
-- the ADR 0147 division vocabulary. Existing Rooms take, in order: their
-- launched Round's ladder division (a ranked Round froze one at Start); a
-- league lobby Room's league division; a tournament Room's age division
-- (the `entry.age_division` lobby setting, Open by default); else their
-- host's division from the stored birth month, read now (adult is Open, any
-- younger band Youth); else Open (no host, or no age record).
-- It reads and writes no rating and cannot refuse.
ALTER TABLE "rooms" ADD COLUMN "division" text;--> statement-breakpoint
UPDATE "rooms" AS r SET "division" = coalesce(
  (SELECT d.ladder_division FROM rounds d
    WHERE d.room_id = r.id AND d.ladder_division IS NOT NULL
    ORDER BY d.created_at DESC, d.id DESC LIMIT 1),
  (SELECT o.league_division FROM lobbies lb JOIN organizations o ON o.id = lb.owner_organization_id
    WHERE lb.id = r.lobby_id),
  CASE WHEN r.lobby_kind = 'tournament' THEN coalesce(
    (SELECT s.value->>'value' FROM settings s
      WHERE s.scope_kind = 'lobby' AND s.lobby_id = r.lobby_id
        AND s.key = 'entry.age_division' AND s.value->>'value' IN ('open', 'youth')
      LIMIT 1),
    'open') END,
  (SELECT CASE public.daisy_age_band(aa.birth_month, aa.version, aa.recorded_at, clock_timestamp())
      WHEN 'adult' THEN 'open'
      WHEN '16-17' THEN 'youth'
      WHEN '13-15' THEN 'youth'
      WHEN 'under-13' THEN 'youth'
    END
    FROM actors host JOIN account_age aa ON aa.user_id = host.user_id
    WHERE host.id = r.host_actor_id),
  'open'
);--> statement-breakpoint
-- The backfill fires deferred triggers on rooms; run them before the DDL.
SET CONSTRAINTS ALL IMMEDIATE;--> statement-breakpoint
ALTER TABLE "rooms" ALTER COLUMN "division" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_division_check" CHECK ("division" in ('open', 'youth'));--> statement-breakpoint
-- A Room keeps the lobby it was created in.
CREATE FUNCTION public.daisy_guard_room_division() RETURNS trigger
LANGUAGE plpgsql AS $guard_room_division$
BEGIN
  IF NEW.division IS DISTINCT FROM OLD.division THEN
    RAISE EXCEPTION 'A Room keeps its division'
      USING ERRCODE = '23514', CONSTRAINT = 'rooms_division_immutable';
  END IF;
  RETURN NEW;
END;
$guard_room_division$;--> statement-breakpoint
CREATE TRIGGER rooms_division_immutable BEFORE UPDATE OF "division" ON "rooms"
FOR EACH ROW EXECUTE FUNCTION public.daisy_guard_room_division();
--> statement-breakpoint
-- Every challenge carries the lobby both members share (ADR 0156), casual
-- included. An unanswered casual offer from before held no lobby and may
-- cross lobbies, so it is withdrawn (offers live minutes; DEC-304 states a
-- destructive step in its PR). An answered one takes its Room's division.
-- The old CHECK held a division on ranked offers only; it goes first.
ALTER TABLE "challenges" DROP CONSTRAINT "challenges_division_check";--> statement-breakpoint
DELETE FROM "challenges" WHERE "division" IS NULL AND "room_id" IS NULL;--> statement-breakpoint
UPDATE "challenges" AS c SET "division" = r.division
  FROM "rooms" r WHERE r.id = c.room_id AND c.division IS NULL;--> statement-breakpoint
SET CONSTRAINTS ALL IMMEDIATE;--> statement-breakpoint
ALTER TABLE "challenges" ALTER COLUMN "division" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_division_check" CHECK ("division" in ('open', 'youth'));
--> statement-breakpoint
-- A Youth Room is a Room of the Youth lobby (ADR 0156), casual included, not
-- a ranked Room a youth debater sits in: the Room chat fact reads
-- `rooms.division` (`youthRoomOf`). Its seated debaters are the youth
-- debaters whose club staff post, as decision 84 says.
DROP FUNCTION public.daisy_room_community_fact(text,text);--> statement-breakpoint
CREATE FUNCTION public.daisy_room_community_fact(requested_room_id text, requested_actor_id text)
RETURNS TABLE(version bigint,status text,visibility text,ended_at timestamptz,host boolean,seat_kind text,channel_id text,authority_revision bigint,youth_room boolean,youth_staff boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $room_community_fact$
 WITH youth_debater AS (
  SELECT seated_actor.user_id
  FROM public.room_participants seated
  JOIN public.rooms youth_room ON youth_room.id=seated.room_id AND youth_room.division='youth'
  JOIN public.actors seated_actor ON seated_actor.id=seated.actor_id
  WHERE seated.room_id=requested_room_id AND seated_actor.kind='human' AND seated.seat_kind in ('side', 'speaker')
   AND seated_actor.user_id IS NOT NULL
 ),
 caller AS (
  SELECT a.user_id FROM public.actors a
  WHERE a.id=requested_actor_id AND a.user_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM public.account_age caller_age WHERE caller_age.user_id=a.user_id
    AND public.daisy_age_band(caller_age.birth_month,caller_age.version,caller_age.recorded_at,clock_timestamp())='adult')
 )
 SELECT r.version::bigint+r.change_version::bigint,r.status,r.visibility,
 CASE WHEN r.status IN ('assembling','ready') THEN NULL ELSE r.updated_at END,
 r.host_actor_id=requested_actor_id,p.seat_kind,
 c.id,c.authority_revision,
 r.division='youth',
 -- Staff matters only to a seatless caller who does not host: everyone else posts.
 CASE WHEN p.seat_kind IS NOT NULL OR r.host_actor_id IS NOT DISTINCT FROM requested_actor_id THEN false ELSE EXISTS (
  SELECT 1 FROM youth_debater d
  JOIN caller ON caller.user_id<>d.user_id
  JOIN public.memberships student ON student.user_id=d.user_id AND student.status='active'
  JOIN public.organizations school ON school.id=student.organization_id AND school.kind='school' AND school.closed_at IS NULL
  WHERE school.owner_user_id=caller.user_id OR EXISTS (
   SELECT 1 FROM public.grants g
   JOIN public.memberships staff ON staff.organization_id=g.organization_id AND staff.user_id=g.user_id AND staff.status='active'
   WHERE g.organization_id=school.id AND g.user_id=caller.user_id AND g.scope_kind='organization'
    AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>clock_timestamp())
    AND EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.role_id=g.role_id AND rp.permission='school.roster.manage'))) END
 FROM public.rooms r LEFT JOIN public.room_participants p ON p.room_id=r.id AND p.actor_id=requested_actor_id
 LEFT JOIN public.messaging_channels c ON c.room_id=r.id AND c.kind='room_community'
 WHERE r.id=requested_room_id AND (c.id IS NULL OR (c.policy_revision=1 AND c.lifecycle='active'));
$room_community_fact$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_room_community_fact(text,text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_room_community_fact(text,text) TO daisy_web, daisy_realtime;
