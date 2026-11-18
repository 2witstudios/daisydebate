-- Decision 84: a seatless member reads a Youth Room's chat and does not post.
-- The Room chat fact gains whether the Room is a Youth Room (a ranked Room a
-- human youth debater sits in, `youthRoomOf`) and whether the caller is a
-- seated youth debater's club staff (an adult who owns the debater's school, or
-- holds a live grant there whose role carries school.roster.manage, as
-- `readLinkedAdultUserIds` reads staff). The division expression is
-- `divisionOfBandSql(divisionAgeBand())` rendered with its parameters inlined;
-- `room-chat-youth-migration.test.ts` fails if the TypeScript rule moves.
DROP FUNCTION public.daisy_room_community_fact(text,text);--> statement-breakpoint
CREATE FUNCTION public.daisy_room_community_fact(requested_room_id text, requested_actor_id text)
RETURNS TABLE(version bigint,status text,visibility text,ended_at timestamptz,host boolean,seat_kind text,channel_id text,authority_revision bigint,youth_room boolean,youth_staff boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $room_community_fact$
 WITH youth_debater AS (
  SELECT seated_actor.user_id
  FROM public.room_participants seated
  JOIN public.rooms ranked_room ON ranked_room.id=seated.room_id AND ranked_room.competition_type='ranked'
  JOIN public.actors seated_actor ON seated_actor.id=seated.actor_id
  LEFT JOIN public.account_age ON account_age.user_id=seated_actor.user_id
  WHERE seated.room_id=requested_room_id AND seated_actor.kind='human' AND seated.seat_kind IN ('side','speaker')
   AND seated_actor.user_id IS NOT NULL
   AND (case case when public.daisy_age_band("account_age"."birth_month", "account_age"."version", "account_age"."recorded_at", clock_timestamp()) is null then null else public.daisy_age_band("account_age"."birth_month", "account_age"."version", "account_age"."recorded_at", least(clock_timestamp(), greatest(coalesce((select youth.starts_at from seasons youth where youth.status = 'active' and youth.division = 'youth' and youth.organization_id = 'fo05z182lha0a3usciy9wr2r'), clock_timestamp()), "account_age"."recorded_at", clock_timestamp() - make_interval(months => 12::int)))) end when 'under-13' then 'youth' when '13-15' then 'youth' when '16-17' then 'youth' when 'adult' then 'open' end) = 'youth'
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
 EXISTS (SELECT 1 FROM youth_debater),
 EXISTS (
  SELECT 1 FROM youth_debater d
  JOIN caller ON caller.user_id<>d.user_id
  JOIN public.memberships student ON student.user_id=d.user_id AND student.status='active'
  JOIN public.organizations school ON school.id=student.organization_id AND school.kind='school' AND school.closed_at IS NULL
  WHERE school.owner_user_id=caller.user_id OR EXISTS (
   SELECT 1 FROM public.grants g
   JOIN public.memberships staff ON staff.organization_id=g.organization_id AND staff.user_id=g.user_id AND staff.status='active'
   WHERE g.organization_id=school.id AND g.user_id=caller.user_id AND g.scope_kind='organization'
    AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>clock_timestamp())
    AND EXISTS (SELECT 1 FROM public.role_permissions rp WHERE rp.role_id=g.role_id AND rp.permission='school.roster.manage')))
 FROM public.rooms r LEFT JOIN public.room_participants p ON p.room_id=r.id AND p.actor_id=requested_actor_id
 LEFT JOIN public.messaging_channels c ON c.room_id=r.id AND c.kind='room_community'
 WHERE r.id=requested_room_id AND (c.id IS NULL OR (c.policy_revision=1 AND c.lifecycle='active'));
$room_community_fact$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_room_community_fact(text,text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_room_community_fact(text,text) TO daisy_web, daisy_realtime;
