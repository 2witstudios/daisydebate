ALTER TABLE "lobbies" ADD COLUMN "standing_lobby_id" text;
--> statement-breakpoint
ALTER TABLE "lobbies" ADD COLUMN "standing_lobby_kind" text GENERATED ALWAYS AS ('standing') STORED;
--> statement-breakpoint
ALTER TABLE "tournaments" DROP COLUMN "admits_minors";
--> statement-breakpoint
ALTER TABLE "lobbies" ALTER COLUMN "age_rule" DROP NOT NULL;
--> statement-breakpoint
UPDATE public.lobbies AS lobby
  SET standing_lobby_id = source.parent_id,
      age_rule = CASE WHEN source.parent_id IS NULL THEN source.age_rule ELSE NULL END
  FROM pg_temp.tournament_lobby_backfill AS source
  WHERE lobby.id = source.tournament_id;
--> statement-breakpoint
-- Freeze the old tournament Room classification before removing its setting.
ALTER TABLE public.rooms DISABLE TRIGGER rooms_lobby_immutable;
--> statement-breakpoint
UPDATE public.rooms AS room
  SET legacy_tournament_youth = (source.age_rule = 'under-18')
  FROM pg_temp.tournament_lobby_backfill AS source
  WHERE room.lobby_id = source.tournament_id
    AND room.lobby_kind = 'tournament'
    AND room.legacy_tournament_youth IS NULL;
--> statement-breakpoint
SET CONSTRAINTS ALL IMMEDIATE;
--> statement-breakpoint
ALTER TABLE public.rooms ENABLE TRIGGER rooms_lobby_immutable;
--> statement-breakpoint
DELETE FROM public.settings WHERE key = 'entry.age_division';
--> statement-breakpoint
SET CONSTRAINTS ALL IMMEDIATE;
--> statement-breakpoint
CREATE INDEX "lobbies_standing_parent_kind_idx" ON "lobbies" ("standing_lobby_id","standing_lobby_kind");
--> statement-breakpoint
CREATE INDEX "lobbies_standing_parent_league_idx" ON "lobbies" ("standing_lobby_id","owner_organization_id");
--> statement-breakpoint
ALTER TABLE "lobbies" ADD CONSTRAINT "lobbies_standing_parent_kind_fk" FOREIGN KEY ("standing_lobby_id","standing_lobby_kind") REFERENCES "lobbies"("id","kind") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "lobbies" ADD CONSTRAINT "lobbies_standing_parent_league_fk" FOREIGN KEY ("standing_lobby_id","owner_organization_id") REFERENCES "lobbies"("id","owner_organization_id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "lobbies" ADD CONSTRAINT "lobbies_age_rule_source" CHECK (case when "kind" = 'tournament' and "owner_organization_id" is not null
        then "standing_lobby_id" is not null and "age_rule" is null
        else "standing_lobby_id" is null and "age_rule" is not null end) NOT VALID;
--> statement-breakpoint
ALTER TABLE "settings" DROP CONSTRAINT "settings_key_check", ADD CONSTRAINT "settings_key_check" CHECK ("key" in ('pairing.preset', 'pairing.method', 'pairing.section_size', 'pairing.rematch', 'pairing.same_school', 'pairing.side_balance', 'pairing.side_alternation', 'pairing.pull_up', 'pairing.position_balance', 'pairing.section_repeat', 'pairing.preference_order', 'bye.recipient', 'bye.result', 'bye.repeat', 'judging.panel', 'judging.availability', 'judging.strike', 'judging.conflict', 'judging.same_school', 'judging.repeat_judge', 'judging.unsubmitted_ballot', 'judging.load_balance', 'judging.chair', 'judging.panel_same_school', 'judging.preference_order', 'standings.tiebreaks', 'standings.rating_ladder', 'break.line', 'break.seeding', 'break.double_qualifier', 'entry.divisions', 'entry.registration', 'entry.approval', 'entry.cap', 'entry.judge_obligation', 'conflict.handling', 'recording.capture', 'judging.ai_judge', 'broadcast.live', 'audience.posting', 'audience.decision', 'audience.scores', 'audience.reason', 'audience.feedback', 'audience.video', 'ballot.screening', 'resolution.rule', 'resolution.own_text', 'room.own_format', 'room.visibility', 'room.timing', 'room.floor', 'staff.minimum_band')) NOT VALID;
--> statement-breakpoint
-- An adults-only tournament can still seat a minor with a signed lobby permission.
CREATE OR REPLACE FUNCTION public.daisy_room_is_youth(requested_room_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $room_youth$
  SELECT CASE
    WHEN r.legacy_tournament_youth IS NOT NULL THEN r.legacy_tournament_youth
    WHEN l.kind = 'tournament' AND rd.standing_age_rule IS NOT NULL THEN rd.standing_youth_cast
    WHEN coalesce(parent.age_rule, l.age_rule) = 'under-18' THEN true
    WHEN coalesce(parent.age_rule, l.age_rule) = 'anyone' OR l.kind = 'tournament' THEN
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
    ELSE false END
  FROM public.rooms r JOIN public.lobbies l ON l.id=r.lobby_id
  LEFT JOIN public.lobbies parent ON parent.id=l.standing_lobby_id
  LEFT JOIN public.rounds rd ON rd.room_id=r.id
  WHERE r.id=requested_room_id
$room_youth$;
--> statement-breakpoint
-- Preserve the effective Youth cast at Start for standing and tournament Rooms.
CREATE OR REPLACE FUNCTION public.daisy_room_youth_recording_cast(requested_room_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $room_youth_recording_cast$
  SELECT CASE WHEN l.kind = 'tournament' THEN public.daisy_room_is_youth(r.id)
    ELSE l.age_rule='under-18' OR EXISTS (
      SELECT 1 FROM public.room_participants p JOIN public.actors a ON a.id=p.actor_id
      WHERE p.room_id=r.id AND p.seat_kind IN ('side','speaker')
        AND public.daisy_debater_was_under_18(a.user_id, statement_timestamp())
    ) END
  FROM public.rooms r JOIN public.lobbies l ON l.id=r.lobby_id
  WHERE r.id=requested_room_id
$room_youth_recording_cast$;
--> statement-breakpoint
-- A mixed cast needs age evidence for recording reuse even after account erasure.
CREATE OR REPLACE FUNCTION public.daisy_round_reuse_age_unknown(requested_round_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $round_reuse_age_unknown$
  SELECT EXISTS (
    SELECT 1 FROM public.rounds rd
    JOIN public.rooms r ON r.id=rd.room_id
    JOIN public.lobbies l ON l.id=r.lobby_id
    LEFT JOIN public.lobbies parent ON parent.id=l.standing_lobby_id
    JOIN public.round_participants p ON p.round_id=rd.id
    JOIN public.actors a ON a.id=p.actor_id AND a.kind='human'
    WHERE rd.id=requested_round_id
      AND ((l.kind='standing' AND (rd.standing_age_rule='anyone' OR l.age_rule='anyone'
        OR (coalesce(rd.standing_age_rule,l.age_rule)='adults' AND rd.standing_youth_cast)))
        OR (l.kind='tournament' AND r.legacy_tournament_youth IS NULL
          AND coalesce(rd.standing_age_rule, parent.age_rule, l.age_rule)<>'under-18'))
      AND p.seat_kind IN ('side','speaker') AND public.daisy_round_participant_is_current(p.id)
      AND NOT EXISTS (SELECT 1 FROM public.account_age age
        WHERE age.user_id=a.user_id
          AND public.daisy_age_band(age.birth_month, age.version,
            least(age.recorded_at, rd.created_at), rd.created_at) IS NOT NULL)
  )
$round_reuse_age_unknown$;
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
  LEFT JOIN public.lobbies parent ON parent.id=youth_lobby.standing_lobby_id
  LEFT JOIN public.rounds rd ON rd.room_id=youth_room.id AND youth_lobby.kind='tournament'
  JOIN public.actors seated_actor ON seated_actor.id=seated.actor_id
  WHERE seated.room_id=requested_room_id AND seated_actor.kind='human' AND seated.seat_kind in ('side', 'speaker')
   AND seated_actor.user_id IS NOT NULL
   AND (youth_room.legacy_tournament_youth IS TRUE
     OR coalesce(rd.standing_age_rule, parent.age_rule, youth_lobby.age_rule)='under-18'
     OR public.daisy_debater_was_under_18(seated_actor.user_id, coalesce(rd.created_at, statement_timestamp())))
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
     AND (public.daisy_room_is_youth(youth_r.room_id) OR youth_r.standing_youth_cast))
   AND NOT EXISTS (SELECT 1 FROM public.rounds rd
     JOIN public.rooms r ON r.id=rd.room_id JOIN public.lobbies l ON l.id=r.lobby_id
     LEFT JOIN public.lobbies parent ON parent.id=l.standing_lobby_id
     WHERE rd.id=requested_round_id
       AND ((l.kind='standing' AND coalesce(rd.standing_age_rule,l.age_rule) IN ('anyone','adults'))
         OR (l.kind='tournament' AND r.legacy_tournament_youth IS NULL
           AND coalesce(rd.standing_age_rule, parent.age_rule, l.age_rule)<>'under-18'))
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
