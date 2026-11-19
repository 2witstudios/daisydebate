-- ADR 0158 (amends ADR 0155 §2 and §7): the linked-adult rule of ADR 0150 §3,
-- once, in two registered SECURITY DEFINER functions (ADR 0129 §4), so the
-- web and the realtime server read the same rule and the realtime role still
-- holds no privilege on any tenant-owned table. `linkedAdultsOfRound` in
-- `@daisy/auth/linked-adults` is its TypeScript statement, and
-- `packages/db/integration/round-linked-adult-actors.integration.ts` holds the
-- two to the same answers.
--
-- A minor's linked adults: an adult (`daisy_age_band`) with an active
-- guardian link to them; the owner of an open school they are an active
-- member of; an active member of that school holding a live organization
-- grant whose role carries `school.roster.manage`. Never the minor.
CREATE FUNCTION public.daisy_linked_adult_users(requested_user_id text)
RETURNS TABLE(user_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $linked_adult_users$
 WITH school AS (
  SELECT o.id, o.owner_user_id
  FROM public.memberships m
  JOIN public.organizations o ON o.id=m.organization_id AND o.kind='school' AND o.closed_at IS NULL
  WHERE m.user_id=requested_user_id AND m.status='active'
 ),
 linked AS (
  SELECT g.guardian_user_id AS user_id FROM public.guardian_links g
  WHERE g.minor_user_id=requested_user_id AND g.status='active'
  UNION
  SELECT s.owner_user_id FROM school s WHERE s.owner_user_id IS NOT NULL
  UNION
  SELECT g.user_id
  FROM school s
  JOIN public.grants g ON g.organization_id=s.id AND g.scope_kind='organization'
   AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>clock_timestamp())
  JOIN public.memberships staff ON staff.organization_id=g.organization_id
   AND staff.user_id=g.user_id AND staff.status='active'
  WHERE EXISTS (SELECT 1 FROM public.role_permissions rp
   WHERE rp.role_id=g.role_id AND rp.permission='school.roster.manage')
 )
 SELECT l.user_id FROM linked l
 JOIN public.account_age age ON age.user_id=l.user_id
  AND public.daisy_age_band(age.birth_month,age.version,age.recorded_at,clock_timestamp())='adult'
 WHERE l.user_id<>requested_user_id
 ORDER BY l.user_id;
$linked_adult_users$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_linked_adult_users(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_linked_adult_users(text) TO daisy_web;--> statement-breakpoint
-- A Youth Round's youth debaters (its current debating seats,
-- `isDebatingSeatSql`, held by a person) and the actors of each one's linked
-- adults. A Round is a Youth Round by `youthRoundSql`: its Room's division or
-- its frozen ladder division. Any other Round has no rows.
CREATE FUNCTION public.daisy_round_linked_adult_actors(requested_round_id text)
RETURNS TABLE(debater_actor_id text, debater_user_id text, linked_adult_actor_ids text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $round_linked_adult_actors$
 WITH debater AS (
  SELECT DISTINCT p.actor_id, a.user_id
  FROM public.round_participants p
  JOIN public.actors a ON a.id=p.actor_id
  WHERE p.round_id=requested_round_id AND p.seat_kind IN ('side','speaker')
   AND public.daisy_round_participant_is_current(p.id) AND a.user_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM public.rounds youth_r
    LEFT JOIN public.rooms youth_room ON youth_room.id=youth_r.room_id
    WHERE youth_r.id=requested_round_id
     AND (youth_room.division='youth' OR youth_r.ladder_division='youth'))
 )
 SELECT d.actor_id, d.user_id,
  coalesce(array_agg(DISTINCT x.id ORDER BY x.id) FILTER (WHERE x.id IS NOT NULL), '{}'::text[])
 FROM debater d
 LEFT JOIN LATERAL public.daisy_linked_adult_users(d.user_id) adult ON true
 LEFT JOIN public.actors x ON x.user_id=adult.user_id
 GROUP BY d.actor_id, d.user_id
 ORDER BY d.actor_id;
$round_linked_adult_actors$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_round_linked_adult_actors(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_round_linked_adult_actors(text) TO daisy_web, daisy_realtime;
