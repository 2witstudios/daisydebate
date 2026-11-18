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
DELETE FROM "challenges" WHERE "division" IS NULL AND "room_id" IS NULL;--> statement-breakpoint
UPDATE "challenges" AS c SET "division" = r.division
  FROM "rooms" r WHERE r.id = c.room_id AND c.division IS NULL;--> statement-breakpoint
ALTER TABLE "challenges" ALTER COLUMN "division" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "challenges" DROP CONSTRAINT "challenges_division_check", ADD CONSTRAINT "challenges_division_check" CHECK ("division" in ('open', 'youth'));
