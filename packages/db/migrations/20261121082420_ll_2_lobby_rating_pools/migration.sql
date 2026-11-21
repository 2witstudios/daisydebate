ALTER TABLE "rating_changes" DROP CONSTRAINT "rating_changes_ladder_ladders_id_fkey";--> statement-breakpoint
ALTER TABLE "rating_changes" DROP CONSTRAINT "rating_changes_season_division_fk";--> statement-breakpoint
ALTER TABLE "rating_changes" DROP CONSTRAINT "rating_changes_round_division_fk";--> statement-breakpoint
ALTER TABLE "ratings" DROP CONSTRAINT "ratings_ladder_ladders_id_fkey";--> statement-breakpoint
ALTER TABLE "ratings" DROP CONSTRAINT "ratings_season_division_fk";--> statement-breakpoint
ALTER TABLE "rounds" DROP CONSTRAINT "rounds_room_league_ladder_fk";--> statement-breakpoint
ALTER TABLE "seasons" DROP CONSTRAINT "seasons_organization_id_organizations_id_fkey";--> statement-breakpoint
ALTER TABLE "rounds" DROP CONSTRAINT "rounds_id_ladder_division_unique";--> statement-breakpoint
ALTER TABLE "seasons" DROP CONSTRAINT "seasons_id_division_unique";--> statement-breakpoint
ALTER TABLE "seasons" DROP CONSTRAINT "seasons_activation_key_division_unique";--> statement-breakpoint
ALTER TABLE "rounds" DROP CONSTRAINT "rounds_league_ladder_source_check";--> statement-breakpoint
ALTER TABLE "rounds" DROP CONSTRAINT "rounds_ladder_check";--> statement-breakpoint
ALTER TABLE "rounds" DROP CONSTRAINT "rounds_ladder_division_check";--> statement-breakpoint
ALTER TABLE "organizations" DROP CONSTRAINT "organizations_league_division_check";--> statement-breakpoint
ALTER TABLE "roles" DROP CONSTRAINT "roles_preset_is_daisy";--> statement-breakpoint
ALTER TABLE "rating_changes" DROP CONSTRAINT "rating_changes_ladder_check";--> statement-breakpoint
ALTER TABLE "rating_changes" DROP CONSTRAINT "rating_changes_division_check";--> statement-breakpoint
ALTER TABLE "ratings" DROP CONSTRAINT "ratings_ladder_check";--> statement-breakpoint
ALTER TABLE "ratings" DROP CONSTRAINT "ratings_division_check";--> statement-breakpoint
ALTER TABLE "seasons" DROP CONSTRAINT "seasons_division_check";--> statement-breakpoint
DROP INDEX "rating_changes_season_division_idx";--> statement-breakpoint
DROP INDEX "rating_changes_round_division_idx";--> statement-breakpoint
DROP INDEX "rating_changes_season_idx";--> statement-breakpoint
DROP INDEX "rating_changes_ladder_idx";--> statement-breakpoint
DROP INDEX "ratings_season_idx";--> statement-breakpoint
DROP INDEX "ratings_ladder_idx";--> statement-breakpoint
DROP INDEX "ratings_season_division_idx";--> statement-breakpoint
DROP INDEX "rounds_room_league_ladder_idx";--> statement-breakpoint
DROP INDEX "rounds_league_ladder_completed_idx";--> statement-breakpoint
ALTER TABLE "ballot_definitions" ADD COLUMN "shared" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "operator_managed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "rating_changes" ADD COLUMN "lobby_id" text;--> statement-breakpoint
ALTER TABLE "ratings" ADD COLUMN "lobby_id" text;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "season_id" text;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "rating_lobby_id" text;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "standing_age_rule" "lobby_age_rule";--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "standing_youth_cast" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "lobby_id" text;--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "lobby_kind" text GENERATED ALWAYS AS ('standing') STORED;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "shared" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DROP INDEX "seasons_single_active";--> statement-breakpoint
ALTER TABLE public.rounds DROP CONSTRAINT rounds_ranked_ladder_check;
--> statement-breakpoint
DROP TRIGGER rounds_league_ladder_immutable ON public.rounds;
--> statement-breakpoint
-- Like the earlier division backfill, rating and Youth metadata changes
-- must preserve already completed Rounds with historical empty judge slots.
ALTER TABLE public.rounds DISABLE TRIGGER rounds_judge_slots_complete;
--> statement-breakpoint
UPDATE public.rounds rd SET standing_age_rule=CASE
  WHEN rd.ladder_division='youth' THEN 'under-18'::public.lobby_age_rule
  WHEN rd.ladder_division='open' THEN 'adults'::public.lobby_age_rule
  ELSE (SELECT l.age_rule FROM public.rooms r
    JOIN public.lobbies l ON l.id=r.lobby_id AND l.kind='standing' WHERE r.id=rd.room_id)
END,
standing_youth_cast=coalesce(rd.ladder_division='youth',false) OR EXISTS (
  SELECT 1 FROM public.rooms r WHERE r.id=rd.room_id AND r.lobby_kind='standing'
    AND public.daisy_room_is_youth(r.id)
)
WHERE rd.room_id IS NOT NULL OR rd.ladder_division IS NOT NULL;
--> statement-breakpoint
UPDATE public.organizations SET operator_managed=true WHERE owner_user_id IS NULL;
--> statement-breakpoint
UPDATE public.templates SET shared=true
WHERE organization_id='fo05z182lha0a3usciy9wr2r';
--> statement-breakpoint
UPDATE public.ballot_definitions SET shared=true
WHERE organization_id='fo05z182lha0a3usciy9wr2r';
--> statement-breakpoint
INSERT INTO public.ladders (id,lobby_id,organization_id,name)
VALUES ('b4bcwbtct1ufmo5ng71fn2i6','m30okvqrv5tzkyci5of5dfav','fo05z182lha0a3usciy9wr2r','Freestyle');
--> statement-breakpoint
-- The reference seasons already have a documented Open or Youth home. Elsewhere,
-- assign a season only when its league already has exactly one standing lobby.
UPDATE public.seasons s SET lobby_id=CASE
  WHEN s.organization_id='fo05z182lha0a3usciy9wr2r' THEN
    CASE s.division WHEN 'youth' THEN 'm30okvqrv5tzkyci5of5dfav'
      ELSE 'rhkgl9vjor1cmyr855wb62ku' END
  ELSE (
    SELECT min(l.id) FROM public.lobbies l
    WHERE l.kind='standing' AND l.owner_organization_id=s.organization_id
    HAVING count(*)=1
  ) END;
--> statement-breakpoint
UPDATE public.seasons s SET ends_at=greatest(s.starts_at+interval '1 millisecond', coalesce(
  (SELECT max(h.applied_at) FROM public.action_history h
    WHERE h.aggregate_kind='season' AND h.aggregate_id=s.id AND h.type='close-season'),
  greatest(s.updated_at,(SELECT max(c.occurred_at) FROM public.rating_changes c WHERE c.season_id=s.id))
))
WHERE s.status='closed' AND s.ends_at IS NULL;
--> statement-breakpoint
-- Only the old ledger attests to an already posted Round. Preserve its exact
-- recorded season and accept a ladder only if it already belongs to that lobby.
WITH posted AS (
  SELECT c.round_id, min(c.season_id) AS season_id, min(c.ladder) AS ladder
  FROM public.rating_changes c GROUP BY c.round_id
  HAVING count(DISTINCT c.season_id)=1 AND count(DISTINCT c.ladder)=1
)
UPDATE public.rounds r SET ladder_id=d.id, season_id=s.id, rating_lobby_id=s.lobby_id
FROM posted c JOIN public.seasons s ON s.id=c.season_id
JOIN public.ladders d ON d.lobby_id=s.lobby_id AND d.id=CASE
  WHEN s.lobby_id='m30okvqrv5tzkyci5of5dfav' AND c.ladder='freestyle'
    THEN 'b4bcwbtct1ufmo5ng71fn2i6' ELSE c.ladder END
WHERE r.id=c.round_id
  AND (r.room_id IS NULL OR EXISTS (
    SELECT 1 FROM public.rooms rm WHERE rm.id=r.room_id AND rm.lobby_id=s.lobby_id
  ));
--> statement-breakpoint
UPDATE public.ratings r SET lobby_id=s.lobby_id, ladder=d.id
FROM public.seasons s, public.ladders d
WHERE r.season_id=s.id AND d.lobby_id=s.lobby_id AND d.id=CASE
  WHEN s.lobby_id='m30okvqrv5tzkyci5of5dfav' AND r.ladder='freestyle'
    THEN 'b4bcwbtct1ufmo5ng71fn2i6' ELSE r.ladder END;
--> statement-breakpoint
UPDATE public.rating_changes c SET lobby_id=r.rating_lobby_id,ladder=r.ladder_id
FROM public.rounds r WHERE r.id=c.round_id AND r.season_id=c.season_id;
--> statement-breakpoint
-- Preserve the context of completed and abandoned ranked Rounds without a
-- posting. They have no pool to settle, replay or assign to an invented season.
UPDATE public.rounds SET ladder_id=NULL WHERE season_id IS NULL AND ladder_id IS NOT NULL;
--> statement-breakpoint
DO $adoption$
BEGIN
  IF EXISTS (SELECT 1 FROM public.seasons WHERE lobby_id IS NULL)
    OR EXISTS (SELECT 1 FROM public.seasons WHERE status='active' GROUP BY lobby_id HAVING count(*)>1)
    OR EXISTS (SELECT 1 FROM public.seasons s JOIN public.lobbies l ON l.id=s.lobby_id
      WHERE s.status='active' AND l.closed_at IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public.ratings WHERE lobby_id IS NULL)
    OR EXISTS (SELECT 1 FROM public.rating_changes WHERE lobby_id IS NULL)
    OR EXISTS (SELECT 1 FROM public.rounds
      WHERE (competition_type='ranked' OR league_ladder_id IS NOT NULL)
        AND season_id IS NULL AND status NOT IN ('completed','abandoned'))
  THEN
    RAISE EXCEPTION 'Rating pool adoption requires explicit standing-lobby assignments or settlement of live rated Rounds';
  END IF;
END;
$adoption$;
--> statement-breakpoint
SET CONSTRAINTS ALL IMMEDIATE;
--> statement-breakpoint
ALTER TABLE public.rounds ENABLE TRIGGER rounds_judge_slots_complete;
--> statement-breakpoint
ALTER TABLE public.seasons ALTER COLUMN lobby_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE public.ratings ALTER COLUMN lobby_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE public.rating_changes ALTER COLUMN lobby_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "organizations" DROP COLUMN "league_division";--> statement-breakpoint
ALTER TABLE "rating_changes" DROP COLUMN "division";--> statement-breakpoint
ALTER TABLE "ratings" DROP COLUMN "division";--> statement-breakpoint
ALTER TABLE "rounds" DROP COLUMN "league_ladder_id";--> statement-breakpoint
ALTER TABLE "rounds" DROP COLUMN "ladder_division";--> statement-breakpoint
ALTER TABLE "seasons" DROP COLUMN "division";--> statement-breakpoint
CREATE UNIQUE INDEX "seasons_single_active" ON "seasons" ("lobby_id") WHERE "status" = 'active';--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_id_rating_pool_unique" UNIQUE("id","ladder_id","season_id");--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_id_lobby_unique" UNIQUE("id","lobby_id");--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_activation_key_lobby_unique" UNIQUE("activation_key","lobby_id");--> statement-breakpoint
CREATE INDEX "rating_changes_season_lobby_idx" ON "rating_changes" ("season_id","lobby_id");--> statement-breakpoint
CREATE INDEX "rating_changes_ladder_lobby_idx" ON "rating_changes" ("ladder","lobby_id");--> statement-breakpoint
CREATE INDEX "rating_changes_round_pool_idx" ON "rating_changes" ("round_id","ladder","season_id");--> statement-breakpoint
CREATE INDEX "ratings_season_lobby_idx" ON "ratings" ("season_id","lobby_id");--> statement-breakpoint
CREATE INDEX "ratings_ladder_lobby_idx" ON "ratings" ("ladder","lobby_id");--> statement-breakpoint
CREATE INDEX "rounds_room_rating_lobby_idx" ON "rounds" ("room_id","rating_lobby_id");--> statement-breakpoint
CREATE INDEX "rounds_ladder_rating_lobby_idx" ON "rounds" ("ladder_id","rating_lobby_id");--> statement-breakpoint
CREATE INDEX "rounds_season_rating_lobby_idx" ON "rounds" ("season_id","rating_lobby_id");--> statement-breakpoint
CREATE INDEX "rounds_ladder_season_completed_idx" ON "rounds" ("ladder_id","season_id","completed_at");--> statement-breakpoint
CREATE INDEX "seasons_lobby_organization_idx" ON "seasons" ("lobby_id","organization_id");--> statement-breakpoint
CREATE INDEX "seasons_lobby_kind_idx" ON "seasons" ("lobby_id","lobby_kind");--> statement-breakpoint
ALTER TABLE "rating_changes" ADD CONSTRAINT "rating_changes_season_lobby_fk" FOREIGN KEY ("season_id","lobby_id") REFERENCES "seasons"("id","lobby_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "rating_changes" ADD CONSTRAINT "rating_changes_ladder_lobby_fk" FOREIGN KEY ("ladder","lobby_id") REFERENCES "ladders"("id","lobby_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "rating_changes" ADD CONSTRAINT "rating_changes_round_pool_fk" FOREIGN KEY ("round_id","ladder","season_id") REFERENCES "rounds"("id","ladder_id","season_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_season_lobby_fk" FOREIGN KEY ("season_id","lobby_id") REFERENCES "seasons"("id","lobby_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_ladder_lobby_fk" FOREIGN KEY ("ladder","lobby_id") REFERENCES "ladders"("id","lobby_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_room_rating_lobby_fk" FOREIGN KEY ("room_id","rating_lobby_id") REFERENCES "rooms"("id","lobby_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_ladder_rating_lobby_fk" FOREIGN KEY ("ladder_id","rating_lobby_id") REFERENCES "ladders"("id","lobby_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_season_rating_lobby_fk" FOREIGN KEY ("season_id","rating_lobby_id") REFERENCES "seasons"("id","lobby_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_lobby_owner_fk" FOREIGN KEY ("lobby_id","organization_id") REFERENCES "lobbies"("id","owner_organization_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_standing_lobby_fk" FOREIGN KEY ("lobby_id","lobby_kind") REFERENCES "lobbies"("id","kind") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_rating_pool_complete" CHECK (num_nonnulls("ladder_id", "season_id", "rating_lobby_id") in (0, 3));--> statement-breakpoint
ALTER TABLE "organizations" DROP CONSTRAINT "organizations_has_owner", ADD CONSTRAINT "organizations_has_owner" CHECK ("owner_user_id" is not null or "operator_managed");--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_ranked_ladder_check" CHECK ("competition_type" <> 'ranked' or "ladder_id" is not null or "status" in ('completed','abandoned'));
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
       AND (rd.standing_age_rule='anyone' OR l.age_rule='anyone')
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
      AND (rd.standing_age_rule='anyone' OR l.age_rule='anyone')
      AND p.seat_kind IN ('side','speaker') AND public.daisy_round_participant_is_current(p.id)
      AND NOT EXISTS (SELECT 1 FROM public.account_age age
        WHERE age.user_id=a.user_id
          AND public.daisy_age_band(age.birth_month, age.version,
            least(age.recorded_at, rd.created_at), rd.created_at) IS NOT NULL)
  )
$round_reuse_age_unknown$;
--> statement-breakpoint
CREATE FUNCTION public.daisy_guard_round_rating_pool() RETURNS trigger
LANGUAGE plpgsql AS $guard_rating_pool$
BEGIN
  IF (NEW.ladder_id,NEW.season_id,NEW.rating_lobby_id,NEW.standing_age_rule,NEW.standing_youth_cast)
     IS DISTINCT FROM (OLD.ladder_id,OLD.season_id,OLD.rating_lobby_id,OLD.standing_age_rule,OLD.standing_youth_cast) THEN
    RAISE EXCEPTION 'The Round rating pool is frozen at Start'
      USING ERRCODE='23514', CONSTRAINT='rounds_rating_pool_immutable';
  END IF;
  RETURN NEW;
END;
$guard_rating_pool$;
--> statement-breakpoint
CREATE TRIGGER rounds_rating_pool_immutable
BEFORE UPDATE OF ladder_id,season_id,rating_lobby_id,standing_age_rule,standing_youth_cast ON public.rounds
FOR EACH ROW EXECUTE FUNCTION public.daisy_guard_round_rating_pool();
--> statement-breakpoint
-- Catalogue publication is managed independently of the organization that owns an item.
CREATE FUNCTION public.daisy_guard_catalogue_marker() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $catalogue_marker$
DECLARE
  was_published boolean := false;
  published boolean := false;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    was_published := coalesce((to_jsonb(OLD)->>TG_ARGV[0])::boolean, false);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    published := coalesce((to_jsonb(NEW)->>TG_ARGV[0])::boolean, false);
  END IF;
  IF was_published IS DISTINCT FROM published AND pg_has_role(current_user, 'daisy_web', 'MEMBER') THEN
    RAISE EXCEPTION 'Catalogue publication requires operator authority'
      USING ERRCODE='23514', CONSTRAINT='catalogue_publication_authority';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$catalogue_marker$;
--> statement-breakpoint
CREATE TRIGGER organizations_operator_marker BEFORE INSERT OR UPDATE OF operator_managed ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.daisy_guard_catalogue_marker('operator_managed');
--> statement-breakpoint
CREATE TRIGGER roles_preset_marker BEFORE INSERT OR UPDATE OF preset OR DELETE ON public.roles
FOR EACH ROW EXECUTE FUNCTION public.daisy_guard_catalogue_marker('preset');
--> statement-breakpoint
CREATE TRIGGER templates_catalogue_marker BEFORE INSERT OR UPDATE OF shared OR DELETE ON public.templates
FOR EACH ROW EXECUTE FUNCTION public.daisy_guard_catalogue_marker('shared');
--> statement-breakpoint
CREATE TRIGGER ballot_catalogue_marker BEFORE INSERT OR UPDATE OF shared OR DELETE ON public.ballot_definitions
FOR EACH ROW EXECUTE FUNCTION public.daisy_guard_catalogue_marker('shared');
--> statement-breakpoint
ALTER TABLE "ratings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "ratings_scope" ON "ratings" FOR ALL USING (lobby_id = daisy_lobby_scope()) WITH CHECK (lobby_id = daisy_lobby_scope());
--> statement-breakpoint
CREATE POLICY "ratings_subject" ON "ratings" FOR SELECT USING (actor_id = daisy_subject_actor_scope());
--> statement-breakpoint
ALTER TABLE "rating_changes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "rating_changes_scope" ON "rating_changes" FOR ALL USING (lobby_id = daisy_lobby_scope()) WITH CHECK (lobby_id = daisy_lobby_scope());
--> statement-breakpoint
CREATE POLICY "rating_changes_subject" ON "rating_changes" FOR SELECT USING (actor_id = daisy_subject_actor_scope());
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_lobby_scope(), public.daisy_subject_actor_scope() TO daisy_audience_publisher;
--> statement-breakpoint
CREATE FUNCTION public.daisy_round_rating_posted(requested_round_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $rating_posted$
  SELECT EXISTS (SELECT 1 FROM public.rating_changes c WHERE c.round_id = requested_round_id)
$rating_posted$;
--> statement-breakpoint
CREATE FUNCTION public.daisy_round_rating_release_facts(requested_round_id text)
RETURNS TABLE (id text, occurred_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $rating_release_facts$
  SELECT c.id, c.occurred_at FROM public.rating_changes c
  JOIN public.rounds r ON r.id = c.round_id
  WHERE r.id = requested_round_id AND r.room_id IS NOT NULL AND r.visibility IN ('public', 'unlisted')
$rating_release_facts$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_round_rating_posted(text), public.daisy_round_rating_release_facts(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_round_rating_posted(text), public.daisy_round_rating_release_facts(text) TO daisy_web;
