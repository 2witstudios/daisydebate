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
ALTER TABLE "seasons" ADD COLUMN "lobby_id" text;--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "lobby_kind" text GENERATED ALWAYS AS ('standing') STORED;--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "shared" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DROP INDEX "seasons_single_active";--> statement-breakpoint
ALTER TABLE public.rounds DROP CONSTRAINT rounds_ranked_ladder_check;
--> statement-breakpoint
DROP TRIGGER rounds_league_ladder_immutable ON public.rounds;
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
-- League seasons could be opened before their first standing lobby existed.
-- Give those histories a home using the existing organization identifier.
INSERT INTO public.lobbies (id,kind,owner_organization_id,name,handle,age_rule)
SELECT o.id,'standing',o.id,o.name,'season-' || o.id,
       CASE WHEN o.league_division='youth' THEN 'under-18' ELSE 'adults' END::public.lobby_age_rule
FROM public.organizations o
WHERE o.kind='league'
  AND EXISTS (SELECT 1 FROM public.seasons s WHERE s.organization_id=o.id)
  AND NOT EXISTS (
    SELECT 1 FROM public.lobbies l WHERE l.owner_organization_id=o.id AND l.kind='standing'
  );
--> statement-breakpoint
-- The reference pair was split by LL-1. The rest of the leagues historically
-- offered one standings surface. Prefer the lobby with a selected ladder.
UPDATE public.seasons s SET lobby_id=CASE
  WHEN s.organization_id='fo05z182lha0a3usciy9wr2r' THEN
    CASE s.division WHEN 'youth' THEN 'm30okvqrv5tzkyci5of5dfav'
      ELSE 'rhkgl9vjor1cmyr855wb62ku' END
  ELSE (
    SELECT l.id FROM public.lobbies l
    WHERE l.kind='standing' AND l.owner_organization_id=s.organization_id
    ORDER BY EXISTS (SELECT 1 FROM public.ladders ld WHERE ld.lobby_id=l.id) DESC,
             l.created_at,l.id
    LIMIT 1
  ) END;
--> statement-breakpoint
UPDATE public.rounds r SET
  rating_lobby_id=coalesce(
    (SELECT ld.lobby_id FROM public.ladders ld WHERE ld.id=r.league_ladder_id),
    CASE r.ladder_division WHEN 'youth' THEN 'm30okvqrv5tzkyci5of5dfav'
      ELSE 'rhkgl9vjor1cmyr855wb62ku' END
  ),
  ladder_id=coalesce(
    r.league_ladder_id,
    CASE r.ladder_division WHEN 'youth' THEN 'b4bcwbtct1ufmo5ng71fn2i6' ELSE r.ladder_id END
  )
WHERE r.ladder_id IS NOT NULL OR r.league_ladder_id IS NOT NULL;
--> statement-breakpoint
-- Historical selected league games had no season requirement. Preserve their
-- eligible replay input in a scoped season. Unposted historical ranked games
-- without any season belong to a closed archive; this does not activate one.
INSERT INTO public.seasons (id,lobby_id,organization_id,name,status,starts_at,ends_at,division)
SELECT (array_agg(r.id ORDER BY r.created_at,r.id))[1],l.id,l.owner_organization_id,
       CASE WHEN bool_or(r.league_ladder_id IS NOT NULL) THEN 'Season 1' ELSE 'Archived rounds' END,
       CASE WHEN bool_or(r.league_ladder_id IS NOT NULL) THEN 'active' ELSE 'closed' END,
       min(r.created_at),
       CASE WHEN bool_or(r.league_ladder_id IS NOT NULL) THEN NULL
         ELSE greatest(max(coalesce(r.completed_at,r.created_at)),min(r.created_at)+interval '1 millisecond') END,
       CASE WHEN l.age_rule='under-18' THEN 'youth' ELSE 'open' END
FROM public.rounds r
JOIN public.lobbies l ON l.id=r.rating_lobby_id
WHERE NOT EXISTS (SELECT 1 FROM public.seasons s WHERE s.lobby_id=l.id)
GROUP BY l.id,l.owner_organization_id,l.age_rule;
--> statement-breakpoint
-- A posted round's actual historical season wins over any timestamp inference.
UPDATE public.rounds r
SET season_id=coalesce(
  (SELECT c.season_id FROM public.rating_changes c WHERE c.round_id=r.id ORDER BY c.id LIMIT 1),
  (SELECT s.id FROM public.seasons s WHERE s.lobby_id=r.rating_lobby_id
   ORDER BY (s.starts_at<=r.created_at AND (s.ends_at IS NULL OR r.created_at<s.ends_at)) DESC,
            (s.starts_at<=r.created_at) DESC,s.starts_at DESC,s.id LIMIT 1)
)
WHERE r.rating_lobby_id IS NOT NULL;
--> statement-breakpoint
UPDATE public.ratings r SET lobby_id=s.lobby_id,
  ladder=CASE WHEN r.division='youth' THEN 'b4bcwbtct1ufmo5ng71fn2i6' ELSE r.ladder END
FROM public.seasons s WHERE s.id=r.season_id;
--> statement-breakpoint
UPDATE public.rating_changes c SET lobby_id=s.lobby_id,
  ladder=CASE WHEN c.division='youth' THEN 'b4bcwbtct1ufmo5ng71fn2i6' ELSE c.ladder END
FROM public.seasons s WHERE s.id=c.season_id;
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
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_ranked_ladder_check" CHECK ("competition_type" <> 'ranked' or "ladder_id" is not null);
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
     AND (public.daisy_room_is_youth(youth_r.room_id) OR EXISTS (SELECT 1 FROM public.lobbies youth_lobby
        WHERE youth_lobby.id=youth_r.rating_lobby_id AND youth_lobby.age_rule='under-18')))
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
CREATE FUNCTION public.daisy_guard_round_rating_pool() RETURNS trigger
LANGUAGE plpgsql AS $guard_rating_pool$
BEGIN
  IF (NEW.ladder_id,NEW.season_id,NEW.rating_lobby_id)
     IS DISTINCT FROM (OLD.ladder_id,OLD.season_id,OLD.rating_lobby_id) THEN
    RAISE EXCEPTION 'The Round rating pool is frozen at Start'
      USING ERRCODE='23514', CONSTRAINT='rounds_rating_pool_immutable';
  END IF;
  RETURN NEW;
END;
$guard_rating_pool$;
--> statement-breakpoint
CREATE TRIGGER rounds_rating_pool_immutable
BEFORE UPDATE OF ladder_id,season_id,rating_lobby_id ON public.rounds
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
