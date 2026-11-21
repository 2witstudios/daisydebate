CREATE TYPE "lobby_age_rule" AS ENUM('adults', 'under-18', 'anyone');
--> statement-breakpoint
ALTER TABLE "challenges" ADD COLUMN "lobby_id" text;
--> statement-breakpoint
ALTER TABLE "lobbies" ADD COLUMN "age_rule" "lobby_age_rule" DEFAULT 'adults'::"lobby_age_rule" NOT NULL;
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "official" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "legacy_tournament_youth" boolean;
--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_legacy_tournament_youth_check" CHECK ("legacy_tournament_youth" is null or "lobby_kind" = 'tournament');
--> statement-breakpoint
-- The existing reference lobby keeps its identity and existing Open history.
UPDATE public.organizations SET official=true WHERE id='fo05z182lha0a3usciy9wr2r';
--> statement-breakpoint
UPDATE public.lobbies SET name='Open' WHERE id='rhkgl9vjor1cmyr855wb62ku';
--> statement-breakpoint
UPDATE public.lobbies AS lobby SET age_rule='under-18'
  FROM public.organizations AS league
  WHERE lobby.kind='standing' AND lobby.owner_organization_id=league.id
    AND league.league_division='youth';
--> statement-breakpoint
INSERT INTO public.lobbies (id, kind, owner_organization_id, name, handle, age_rule)
VALUES ('m30okvqrv5tzkyci5of5dfav', 'standing', 'fo05z182lha0a3usciy9wr2r', 'Youth',
  CASE WHEN EXISTS (SELECT 1 FROM public.lobbies WHERE lower(handle)='daisy-youth')
    THEN 'm30okvqrv5tzkyci5of5dfav' ELSE 'daisy-youth' END, 'under-18');
--> statement-breakpoint
-- A standing Room's template pin must still point to an offer in its parent.
INSERT INTO public.lobby_templates (lobby_id, template_id, withdrawn_at, created_at)
SELECT 'm30okvqrv5tzkyci5of5dfav', template_id, withdrawn_at, created_at
  FROM public.lobby_templates WHERE lobby_id='rhkgl9vjor1cmyr855wb62ku';
--> statement-breakpoint
ALTER TABLE public.rooms DISABLE TRIGGER rooms_lobby_immutable;
--> statement-breakpoint
-- The prior backfill sometimes used the tournament owner's legacy division.
-- Preserve the historical Room result without changing tournament admission.
UPDATE public.rooms SET legacy_tournament_youth=(division='youth') WHERE lobby_kind='tournament';
--> statement-breakpoint
UPDATE public.rooms SET lobby_id='m30okvqrv5tzkyci5of5dfav'
  WHERE lobby_id='rhkgl9vjor1cmyr855wb62ku' AND division='youth';
--> statement-breakpoint
UPDATE public.challenges AS challenge SET lobby_id=coalesce(
  (SELECT room.lobby_id FROM public.rooms AS room WHERE room.id=challenge.room_id),
  CASE challenge.division
    WHEN 'youth' THEN 'm30okvqrv5tzkyci5of5dfav'
    ELSE 'rhkgl9vjor1cmyr855wb62ku'
  END
);
--> statement-breakpoint
SET CONSTRAINTS ALL IMMEDIATE;
--> statement-breakpoint
DROP TRIGGER rooms_lobby_immutable ON public.rooms;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.daisy_guard_room_lobby() RETURNS trigger
LANGUAGE plpgsql AS $guard_room_lobby$
BEGIN
  IF (NEW.lobby_id, NEW.lobby_kind, NEW.legacy_tournament_youth)
    IS DISTINCT FROM (OLD.lobby_id, OLD.lobby_kind, OLD.legacy_tournament_youth) THEN
    RAISE EXCEPTION 'A Room keeps its lobby and historical tournament classification'
      USING ERRCODE = '23514', CONSTRAINT = 'rooms_lobby_immutable';
  END IF;
  RETURN NEW;
END;
$guard_room_lobby$;
--> statement-breakpoint
CREATE TRIGGER rooms_lobby_immutable BEFORE UPDATE OF lobby_id,lobby_kind,legacy_tournament_youth ON public.rooms
FOR EACH ROW EXECUTE FUNCTION public.daisy_guard_room_lobby();
--> statement-breakpoint
ALTER TABLE public.challenges ALTER COLUMN lobby_id SET NOT NULL;
--> statement-breakpoint
-- Tournament entry and its age setting retain their own key until Tab inherits
-- standing lobby rules. Chat and Recording only consume the classification.
CREATE FUNCTION public.daisy_debater_was_under_18(requested_user_id text, as_of timestamptz) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp
AS $debater_was_under_18$
  SELECT EXISTS (SELECT 1 FROM public.account_age age
    WHERE age.user_id=requested_user_id
      AND public.daisy_age_band(age.birth_month, age.version, least(age.recorded_at, as_of), as_of)
        IN ('under-13', '13-15', '16-17'))
$debater_was_under_18$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_debater_was_under_18(text,timestamptz) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.daisy_room_is_youth(requested_room_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $room_youth$
  SELECT CASE
    WHEN l.kind='standing' AND l.age_rule='anyone' THEN
      CASE WHEN rd.id IS NULL THEN EXISTS (
        SELECT 1 FROM public.room_participants p JOIN public.actors a ON a.id=p.actor_id
        WHERE p.room_id=r.id AND p.seat_kind IN ('side','speaker')
          AND public.daisy_debater_was_under_18(a.user_id, statement_timestamp())
      ) ELSE EXISTS (
        SELECT 1 FROM public.round_participants p JOIN public.actors a ON a.id=p.actor_id
        WHERE p.round_id=rd.id AND p.seat_kind IN ('side','speaker')
          AND public.daisy_round_participant_is_current(p.id)
          AND public.daisy_debater_was_under_18(a.user_id, rd.created_at)
      ) END
    WHEN l.kind='standing' THEN l.age_rule='under-18'
    ELSE coalesce(r.legacy_tournament_youth, EXISTS (
      SELECT 1 FROM public.settings s WHERE s.scope_kind='lobby' AND s.lobby_id=l.id
        AND s.key='entry.age_division' AND s.value->>'value'='youth'
    )) END
  FROM public.rooms r JOIN public.lobbies l ON l.id=r.lobby_id
  LEFT JOIN public.rounds rd ON rd.room_id=r.id
  WHERE r.id=requested_room_id
$room_youth$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_room_is_youth(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_room_is_youth(text) TO daisy_web, daisy_realtime, daisy_audience_publisher;
--> statement-breakpoint
-- Mixed-age media cannot be reused once a current debater's age evidence is
-- gone. This fact is for reuse only and never grants a linked adult access.
CREATE FUNCTION public.daisy_round_reuse_age_unknown(requested_round_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $round_reuse_age_unknown$
  SELECT EXISTS (
    SELECT 1 FROM public.rounds rd
    JOIN public.rooms r ON r.id=rd.room_id
    JOIN public.lobbies l ON l.id=r.lobby_id
    JOIN public.round_participants p ON p.round_id=rd.id
    JOIN public.actors a ON a.id=p.actor_id AND a.kind='human'
    WHERE rd.id=requested_round_id AND l.kind='standing' AND l.age_rule='anyone'
      AND p.seat_kind IN ('side','speaker') AND public.daisy_round_participant_is_current(p.id)
      AND NOT EXISTS (SELECT 1 FROM public.account_age age
        WHERE age.user_id=a.user_id
          AND public.daisy_age_band(age.birth_month, age.version,
            least(age.recorded_at, rd.created_at), rd.created_at) IS NOT NULL)
  )
$round_reuse_age_unknown$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_round_reuse_age_unknown(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_round_reuse_age_unknown(text) TO daisy_web;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.daisy_room_community_fact(requested_room_id text, requested_actor_id text)
RETURNS TABLE(version bigint,status text,visibility text,ended_at timestamptz,host boolean,seat_kind text,channel_id text,authority_revision bigint,youth_room boolean,youth_staff boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $room_community_fact$
 WITH youth_debater AS (
  SELECT seated_actor.user_id
  FROM public.room_participants seated
  JOIN public.rooms youth_room ON youth_room.id=seated.room_id AND public.daisy_room_is_youth(youth_room.id)
  JOIN public.lobbies youth_lobby ON youth_lobby.id=youth_room.lobby_id
  JOIN public.actors seated_actor ON seated_actor.id=seated.actor_id
  WHERE seated.room_id=requested_room_id AND seated_actor.kind='human' AND seated.seat_kind in ('side', 'speaker')
   AND seated_actor.user_id IS NOT NULL
   AND (youth_lobby.age_rule<>'anyone'
     OR public.daisy_debater_was_under_18(seated_actor.user_id, statement_timestamp()))
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
 public.daisy_room_is_youth(r.id),
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
$room_community_fact$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.daisy_round_linked_adult_actors(requested_round_id text)
RETURNS TABLE(debater_actor_id text, debater_user_id text, linked_adult_actor_ids text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $round_linked_adult_actors$
 WITH debater AS (
  SELECT DISTINCT p.actor_id, a.user_id
  FROM public.round_participants p
  JOIN public.actors a ON a.id=p.actor_id
  WHERE p.round_id=requested_round_id AND p.seat_kind IN ('side','speaker')
   AND public.daisy_round_participant_is_current(p.id) AND a.user_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM public.rounds youth_r
    WHERE youth_r.id=requested_round_id
     AND (public.daisy_room_is_youth(youth_r.room_id) OR youth_r.ladder_division='youth'))
   AND NOT EXISTS (SELECT 1 FROM public.rounds rd
     JOIN public.rooms r ON r.id=rd.room_id JOIN public.lobbies l ON l.id=r.lobby_id
     WHERE rd.id=requested_round_id AND l.kind='standing' AND l.age_rule='anyone'
       AND NOT public.daisy_debater_was_under_18(a.user_id, rd.created_at))
 )
 SELECT d.actor_id, d.user_id,
  coalesce(array_agg(DISTINCT x.id ORDER BY x.id) FILTER (WHERE x.id IS NOT NULL), '{}'::text[])
 FROM debater d
 LEFT JOIN LATERAL public.daisy_linked_adult_users(d.user_id) adult ON true
 LEFT JOIN public.actors x ON x.user_id=adult.user_id
 GROUP BY d.actor_id, d.user_id
 ORDER BY d.actor_id;
$round_linked_adult_actors$;
--> statement-breakpoint
DROP TRIGGER rooms_division_immutable ON public.rooms;
--> statement-breakpoint
DROP FUNCTION public.daisy_guard_room_division();
--> statement-breakpoint
ALTER TABLE "challenges" DROP CONSTRAINT "challenges_room_id_rooms_id_fkey";
--> statement-breakpoint
ALTER TABLE "challenges" DROP CONSTRAINT "challenges_division_check";
--> statement-breakpoint
ALTER TABLE "rooms" DROP CONSTRAINT "rooms_division_check";
--> statement-breakpoint
ALTER TABLE "challenges" DROP COLUMN "division";
--> statement-breakpoint
ALTER TABLE "rooms" DROP COLUMN "division";
--> statement-breakpoint
DROP INDEX "rooms_discovery_assembly_idx";
--> statement-breakpoint
CREATE INDEX "rooms_discovery_assembly_idx" ON "rooms" ("lobby_id","created_at","id" collate "C") WHERE "status" in ('assembling', 'ready');
--> statement-breakpoint
CREATE INDEX "challenges_lobby_idx" ON "challenges" ("lobby_id");
--> statement-breakpoint
CREATE INDEX "challenges_room_lobby_idx" ON "challenges" ("room_id","lobby_id");
--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_lobby_id_lobbies_id_fkey" FOREIGN KEY ("lobby_id") REFERENCES "lobbies"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_room_lobby_fk" FOREIGN KEY ("room_id","lobby_id") REFERENCES "rooms"("id","lobby_id") ON DELETE CASCADE;
