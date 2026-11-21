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
ALTER TABLE "rounds" ADD COLUMN "legacy_league_rating" boolean DEFAULT false NOT NULL;--> statement-breakpoint
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
),
legacy_league_rating=rd.status='completed' AND rd.league_ladder_id IS NOT NULL
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
-- An existing league season follows the standing lobby with the most
-- selected Rooms in that season. Rating selection was stored on the Room
-- and frozen on the Round. The reference pair retains its division history.
UPDATE public.seasons s SET lobby_id=CASE
  WHEN s.organization_id='fo05z182lha0a3usciy9wr2r' THEN
    CASE s.division WHEN 'youth' THEN 'm30okvqrv5tzkyci5of5dfav'
      ELSE 'rhkgl9vjor1cmyr855wb62ku' END
  ELSE (
    SELECT l.id FROM public.lobbies l
    WHERE l.kind='standing' AND l.owner_organization_id=s.organization_id
    ORDER BY (s.status='active' AND l.closed_at IS NULL) DESC,
             (SELECT count(*) FROM public.rounds d
               JOIN public.ladders ld ON ld.id=d.league_ladder_id
               WHERE ld.lobby_id=l.id AND d.created_at>=s.starts_at
                 AND (s.ends_at IS NULL OR d.created_at<s.ends_at)) DESC,
             (CASE l.age_rule WHEN 'under-18' THEN 'youth' ELSE 'open' END=s.division) DESC,
             EXISTS (SELECT 1 FROM public.ladders ld WHERE ld.lobby_id=l.id) DESC,
             l.created_at,l.id
    LIMIT 1
  ) END;
--> statement-breakpoint
UPDATE public.seasons s SET ends_at=greatest(s.starts_at+interval '1 millisecond', coalesce(
  (SELECT max(h.applied_at) FROM public.action_history h
    WHERE h.aggregate_kind='season' AND h.aggregate_id=s.id AND h.type='close-season'),
  greatest(s.updated_at,(SELECT max(c.occurred_at) FROM public.rating_changes c WHERE c.season_id=s.id))
))
WHERE s.status='closed' AND s.ends_at IS NULL;
--> statement-breakpoint
-- A parented Round follows its actual Room. A legacy parentless ranked
-- Round still follows the reference ladder named by its division.
UPDATE public.rounds r SET rating_lobby_id=coalesce(
  (SELECT rm.lobby_id FROM public.rooms rm WHERE rm.id=r.room_id AND rm.lobby_kind='standing'),
  (SELECT ld.lobby_id FROM public.ladders ld WHERE ld.id=r.league_ladder_id),
  CASE r.ladder_division WHEN 'youth' THEN 'm30okvqrv5tzkyci5of5dfav'
    ELSE 'rhkgl9vjor1cmyr855wb62ku' END
)
WHERE r.ladder_id IS NOT NULL OR r.league_ladder_id IS NOT NULL;
--> statement-breakpoint
INSERT INTO public.ladders (id,lobby_id,organization_id,name)
SELECT 'l'||left(md5('legacy-ranked:'||l.id),23),l.id,l.owner_organization_id,'Freestyle'
FROM public.lobbies l
WHERE EXISTS (SELECT 1 FROM public.rounds r WHERE r.rating_lobby_id=l.id)
  AND NOT EXISTS (SELECT 1 FROM public.ladders ld WHERE ld.lobby_id=l.id);
--> statement-breakpoint
UPDATE public.rounds r SET ladder_id=coalesce(
  r.league_ladder_id,
  (SELECT ld.id FROM public.ladders ld WHERE ld.lobby_id=r.rating_lobby_id
    ORDER BY ld.created_at,ld.id LIMIT 1)
)
WHERE r.rating_lobby_id IS NOT NULL;
--> statement-breakpoint
-- Keep the original season ID for existing signatures and sanctions. A
-- second lobby with actual Round history receives its own copy of the
-- period, and postings follow the Round rather than the canonical copy.
CREATE TEMP TABLE ll2_season_destinations ON COMMIT DROP AS
WITH witnessed AS (
  SELECT DISTINCT r.rating_lobby_id AS lobby_id,
    coalesce(
      (SELECT c.season_id FROM public.rating_changes c WHERE c.round_id=r.id ORDER BY c.id LIMIT 1),
      (SELECT s.id
       FROM public.seasons s
       JOIN public.lobbies l ON l.id=r.rating_lobby_id
       JOIN public.organizations o ON o.id=l.owner_organization_id
       WHERE s.organization_id=l.owner_organization_id
         AND (r.ladder_division IS NULL OR s.division=r.ladder_division)
       ORDER BY (s.starts_at<=r.created_at AND (s.ends_at IS NULL OR r.created_at<s.ends_at)) DESC,
         (s.starts_at<=r.created_at) DESC,
         CASE WHEN s.starts_at>r.created_at THEN s.starts_at END,
         (s.division=o.league_division) DESC, s.starts_at DESC,(s.lobby_id=l.id) DESC,s.id LIMIT 1)
    ) AS source_id,
    r.id AS round_id
  FROM public.rounds r WHERE r.rating_lobby_id IS NOT NULL
)
SELECT w.*,CASE WHEN s.lobby_id=w.lobby_id THEN s.id
  ELSE 's'||left(md5(s.id||':'||w.lobby_id),23) END AS season_id
FROM witnessed w LEFT JOIN public.seasons s ON s.id=w.source_id;
--> statement-breakpoint
INSERT INTO public.seasons (id,lobby_id,organization_id,name,status,starts_at,ends_at,division,created_at,updated_at,version)
SELECT DISTINCT d.season_id,l.id,l.owner_organization_id,s.name,
  CASE WHEN s.status='active'
    AND NOT EXISTS (SELECT 1 FROM public.seasons local WHERE local.lobby_id=l.id AND local.status='active')
    AND NOT EXISTS (SELECT 1 FROM ll2_season_destinations other
      JOIN public.seasons os ON os.id=other.source_id WHERE other.lobby_id=l.id AND os.status='active'
         AND (os.starts_at,os.id)>(s.starts_at,s.id))
  THEN 'active' ELSE 'closed' END,
  s.starts_at,s.ends_at,s.division,s.created_at,s.updated_at,s.version
FROM ll2_season_destinations d JOIN public.seasons s ON s.id=d.source_id
JOIN public.lobbies l ON l.id=d.lobby_id
WHERE d.season_id<>d.source_id;
--> statement-breakpoint
INSERT INTO public.season_standing_rules
  (season_id,organization_id,counting,counts_lobby_rooms,rule,created_at,updated_at,version)
SELECT DISTINCT d.season_id,r.organization_id,r.counting,r.counts_lobby_rooms,
  r.rule,r.created_at,r.updated_at,r.version
FROM ll2_season_destinations d
JOIN public.season_standing_rules r ON r.season_id=d.source_id
JOIN public.seasons destination ON destination.id=d.season_id
  AND destination.organization_id=r.organization_id
WHERE d.season_id<>d.source_id;
--> statement-breakpoint
-- A legacy selected league Round could rate without a season. Preserve an
-- active period for that established ladder when it has no prior season.
-- Other unseasoned legacy games stay in a closed archive where needed.
INSERT INTO public.seasons (id,lobby_id,organization_id,name,status,starts_at,ends_at,division)
SELECT 's'||left(md5('legacy-unseasoned:'||l.id),23),l.id,l.owner_organization_id,
       CASE WHEN bool_or(r.league_ladder_id IS NOT NULL) THEN 'Season 1' ELSE 'Archived rounds' END,
       CASE WHEN bool_or(r.league_ladder_id IS NOT NULL) AND NOT EXISTS (
         SELECT 1 FROM public.seasons local WHERE local.lobby_id=l.id) THEN 'active' ELSE 'closed' END,
       min(r.created_at),
       CASE WHEN bool_or(r.league_ladder_id IS NOT NULL) AND NOT EXISTS (
         SELECT 1 FROM public.seasons local WHERE local.lobby_id=l.id) THEN NULL
         ELSE greatest(max(coalesce(r.completed_at,r.created_at)),min(r.created_at)+interval '1 millisecond') END,
       CASE WHEN l.age_rule='under-18' THEN 'youth' ELSE 'open' END
FROM ll2_season_destinations d JOIN public.rounds r ON r.id=d.round_id
JOIN public.lobbies l ON l.id=d.lobby_id
WHERE d.season_id IS NULL
GROUP BY l.id,l.owner_organization_id,l.age_rule;
--> statement-breakpoint
UPDATE public.rounds r SET season_id=coalesce(
  d.season_id,'s'||left(md5('legacy-unseasoned:'||d.lobby_id),23)
)
FROM ll2_season_destinations d WHERE d.round_id=r.id;
--> statement-breakpoint
-- The original projection follows its newest posting. Fill other pools
-- from their own last recorded transition. Legacy ledger-only identities
-- remain ledger-only, including historical non-debating participants.
CREATE TEMP TABLE ll2_rating_tip ON COMMIT DROP AS
SELECT DISTINCT ON (c.actor_id,c.ladder,c.season_id,r.ladder_id,r.season_id)
  c.actor_id,c.ladder AS legacy_ladder,c.season_id AS legacy_season,
  r.ladder_id,r.season_id,r.rating_lobby_id,
  c.rating_after,c.deviation_after,c.volatility_after,c.occurred_at,c.id,
  count(*) OVER (PARTITION BY c.actor_id,r.ladder_id,r.season_id)::integer AS version
FROM public.rating_changes c JOIN public.rounds r ON r.id=c.round_id
WHERE EXISTS (
  SELECT 1 FROM public.ratings p
  WHERE p.actor_id=c.actor_id AND p.ladder=c.ladder AND p.season_id=c.season_id
)
AND EXISTS (
  SELECT 1 FROM public.round_participants p
  WHERE p.round_id=c.round_id AND p.actor_id=c.actor_id
    AND p.seat_kind IN ('side','speaker')
)
ORDER BY c.actor_id,c.ladder,c.season_id,r.ladder_id,r.season_id,c.occurred_at DESC,c.id DESC;
--> statement-breakpoint
WITH tips AS (
  SELECT DISTINCT ON (actor_id,legacy_ladder,legacy_season) *
  FROM ll2_rating_tip ORDER BY actor_id,legacy_ladder,legacy_season,occurred_at DESC,id DESC
)
UPDATE public.ratings r
SET lobby_id=coalesce(t.rating_lobby_id,s.lobby_id),
    season_id=coalesce(t.season_id,s.id),
    ladder=coalesce(t.ladder_id,CASE r.division WHEN 'youth' THEN 'b4bcwbtct1ufmo5ng71fn2i6' ELSE r.ladder END)
FROM public.seasons s LEFT JOIN tips t ON t.legacy_season=s.id
WHERE s.id=r.season_id AND ((t.actor_id=r.actor_id AND t.legacy_ladder=r.ladder) OR t.actor_id IS NULL);
--> statement-breakpoint
-- When some actors had postings and others had only a projection, the
-- latter keep their original season and receive its canonical ladder.
UPDATE public.ratings r SET lobby_id=s.lobby_id,
  ladder=CASE r.division WHEN 'youth' THEN 'b4bcwbtct1ufmo5ng71fn2i6' ELSE r.ladder END
FROM public.seasons s WHERE r.lobby_id IS NULL AND s.id=r.season_id;
--> statement-breakpoint
INSERT INTO public.ratings (actor_id,ladder,season_id,lobby_id,division,rating,deviation,volatility,updated_at,version)
SELECT t.actor_id,t.ladder_id,t.season_id,t.rating_lobby_id,s.division,
  t.rating_after,t.deviation_after,t.volatility_after,t.occurred_at,t.version
FROM ll2_rating_tip t JOIN public.seasons s ON s.id=t.season_id
ON CONFLICT (actor_id,ladder,season_id) DO NOTHING;
--> statement-breakpoint
UPDATE public.rating_changes c SET lobby_id=r.rating_lobby_id,ladder=r.ladder_id,season_id=r.season_id
FROM public.rounds r WHERE r.id=c.round_id;
--> statement-breakpoint
UPDATE public.seasons s SET ends_at=greatest(
  s.starts_at+interval '1 millisecond', s.updated_at,
  (SELECT max(c.occurred_at) FROM public.rating_changes c WHERE c.season_id=s.id)
)
WHERE s.status='closed' AND s.ends_at IS NULL;
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
  IF (NEW.ladder_id,NEW.season_id,NEW.rating_lobby_id,NEW.standing_age_rule,NEW.standing_youth_cast,NEW.legacy_league_rating)
     IS DISTINCT FROM (OLD.ladder_id,OLD.season_id,OLD.rating_lobby_id,OLD.standing_age_rule,OLD.standing_youth_cast,OLD.legacy_league_rating) THEN
    RAISE EXCEPTION 'The Round rating pool is frozen at Start'
      USING ERRCODE='23514', CONSTRAINT='rounds_rating_pool_immutable';
  END IF;
  RETURN NEW;
END;
$guard_rating_pool$;
--> statement-breakpoint
CREATE TRIGGER rounds_rating_pool_immutable
BEFORE UPDATE OF ladder_id,season_id,rating_lobby_id,standing_age_rule,standing_youth_cast,legacy_league_rating ON public.rounds
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
