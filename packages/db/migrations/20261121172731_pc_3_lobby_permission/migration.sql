CREATE TABLE "restriction_lobby_waivers" (
	"guardian_link_id" text,
	"guardian_user_id" text NOT NULL,
	"minor_user_id" text NOT NULL,
	"lobby_id" text,
	"season_id" text,
	"waiver_version" text,
	"waiver_digest" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "restriction_lobby_waivers_pkey" PRIMARY KEY("guardian_link_id","lobby_id","season_id","waiver_version"),
	CONSTRAINT "restriction_lobby_waivers_evidence_check" CHECK (char_length("waiver_version") between 1 and 64 and "waiver_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "restriction_lobbies" ADD COLUMN "signed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "restriction_lobbies" ADD COLUMN "waiver_version" text;--> statement-breakpoint
ALTER TABLE "restriction_lobbies" ADD COLUMN "waiver_digest" text;--> statement-breakpoint
ALTER TABLE "restriction_lobby_waivers" ADD CONSTRAINT "restriction_lobby_waivers_permission_fk" FOREIGN KEY ("guardian_link_id","lobby_id") REFERENCES "restriction_lobbies"("guardian_link_id","lobby_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "restriction_lobby_waivers" ADD CONSTRAINT "restriction_lobby_waivers_guardian_link_fk" FOREIGN KEY ("guardian_link_id","guardian_user_id","minor_user_id") REFERENCES "guardian_links"("id","guardian_user_id","minor_user_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "restriction_lobby_waivers" ADD CONSTRAINT "restriction_lobby_waivers_season_fk" FOREIGN KEY ("season_id","lobby_id") REFERENCES "seasons"("id","lobby_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "restriction_lobbies" ADD CONSTRAINT "restriction_lobbies_signature_check" CHECK (num_nonnulls("signed_at", "waiver_version", "waiver_digest") in (0, 3)
        and ("signed_at" is null or "signed_at" >= "created_at")
        and char_length("waiver_version") between 1 and 64
        and "waiver_digest" ~ '^[0-9a-f]{64}$');--> statement-breakpoint

GRANT INSERT (guardian_link_id, guardian_user_id, minor_user_id, lobby_id)
  ON restriction_lobbies TO daisy_web;--> statement-breakpoint
GRANT UPDATE (signed_at, waiver_version, waiver_digest)
  ON restriction_lobbies TO daisy_web;--> statement-breakpoint

CREATE POLICY restriction_lobbies_request ON restriction_lobbies
  FOR INSERT
  WITH CHECK (
    minor_user_id = daisy_subject_scope()
    AND lobby_id = daisy_lobby_scope()
    AND signed_at IS NULL
    AND waiver_version IS NULL
    AND waiver_digest IS NULL
    AND EXISTS (
      SELECT 1 FROM guardian_links link
      WHERE link.id = guardian_link_id AND link.status = 'active'
    )
    AND EXISTS (
      SELECT 1 FROM lobbies lobby
      WHERE lobby.id = lobby_id AND lobby.kind = 'standing'
        AND lobby.age_rule = 'adults' AND lobby.closed_at IS NULL
    )
  );--> statement-breakpoint

CREATE POLICY restriction_lobbies_sign ON restriction_lobbies
  FOR UPDATE
  USING (
    guardian_user_id = daisy_subject_scope()
    AND lobby_id = daisy_lobby_scope()
    AND signed_at IS NULL
    AND EXISTS (
      SELECT 1 FROM guardian_links link
      WHERE link.id = guardian_link_id AND link.status = 'active'
    )
  )
  WITH CHECK (
    guardian_user_id = daisy_subject_scope()
    AND lobby_id = daisy_lobby_scope()
    AND signed_at IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM lobbies lobby
      WHERE lobby.id = lobby_id AND lobby.kind = 'standing'
        AND lobby.age_rule = 'adults' AND lobby.closed_at IS NULL
    )
  );
--> statement-breakpoint
ALTER TABLE restriction_lobby_waivers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE restriction_lobby_waivers FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON restriction_lobby_waivers FROM PUBLIC, daisy_web;
--> statement-breakpoint
GRANT SELECT ON restriction_lobby_waivers TO daisy_web;
--> statement-breakpoint
GRANT INSERT (guardian_link_id, guardian_user_id, minor_user_id, lobby_id, season_id, waiver_version, waiver_digest)
  ON restriction_lobby_waivers TO daisy_web;
--> statement-breakpoint
CREATE POLICY restriction_lobby_waivers_subject ON restriction_lobby_waivers
  FOR SELECT USING (guardian_user_id = daisy_subject_scope() OR minor_user_id = daisy_subject_scope());
--> statement-breakpoint
CREATE POLICY restriction_lobby_waivers_sign ON restriction_lobby_waivers
  FOR INSERT WITH CHECK (
    guardian_user_id = daisy_subject_scope()
    AND lobby_id = daisy_lobby_scope()
    AND EXISTS (
      SELECT 1 FROM restriction_lobbies permission
      JOIN guardian_links link ON link.id = permission.guardian_link_id
      WHERE permission.guardian_link_id = restriction_lobby_waivers.guardian_link_id
        AND permission.lobby_id = restriction_lobby_waivers.lobby_id
        AND permission.signed_at IS NOT NULL AND link.status = 'active'
    )
    AND EXISTS (
      SELECT 1 FROM seasons season
      WHERE season.id = restriction_lobby_waivers.season_id
        AND season.lobby_id = restriction_lobby_waivers.lobby_id AND season.status = 'active'
    )
  );
--> statement-breakpoint
-- Freeze the recording's cast at Start without changing Room chat authority.
CREATE FUNCTION public.daisy_room_youth_recording_cast(requested_room_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $room_youth_recording_cast$
  SELECT EXISTS (
    SELECT 1 FROM public.rooms r JOIN public.lobbies l ON l.id=r.lobby_id
    WHERE r.id=requested_room_id AND l.kind='standing'
      AND (l.age_rule='under-18' OR EXISTS (
        SELECT 1 FROM public.room_participants p JOIN public.actors a ON a.id=p.actor_id
        WHERE p.room_id=r.id AND p.seat_kind IN ('side','speaker')
          AND public.daisy_debater_was_under_18(a.user_id, statement_timestamp())
      ))
  )
$room_youth_recording_cast$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_room_youth_recording_cast(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_room_youth_recording_cast(text) TO daisy_web;
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
     WHERE rd.id=requested_round_id AND l.kind='standing'
       AND coalesce(rd.standing_age_rule,l.age_rule) IN ('anyone','adults')
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
CREATE OR REPLACE FUNCTION public.daisy_round_reuse_age_unknown(requested_round_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $round_reuse_age_unknown$
  SELECT EXISTS (
    SELECT 1 FROM public.rounds rd
    JOIN public.rooms r ON r.id=rd.room_id
    JOIN public.lobbies l ON l.id=r.lobby_id
    JOIN public.round_participants p ON p.round_id=rd.id
    JOIN public.actors a ON a.id=p.actor_id AND a.kind='human'
    WHERE rd.id=requested_round_id AND l.kind='standing'
      AND (rd.standing_age_rule='anyone' OR l.age_rule='anyone'
        OR (coalesce(rd.standing_age_rule,l.age_rule)='adults' AND rd.standing_youth_cast))
      AND p.seat_kind IN ('side','speaker') AND public.daisy_round_participant_is_current(p.id)
      AND NOT EXISTS (SELECT 1 FROM public.account_age age
        WHERE age.user_id=a.user_id
          AND public.daisy_age_band(age.birth_month, age.version,
            least(age.recorded_at, rd.created_at), rd.created_at) IS NOT NULL)
  )
$round_reuse_age_unknown$;
