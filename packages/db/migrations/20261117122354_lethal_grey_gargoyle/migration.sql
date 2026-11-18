CREATE TABLE "league_schools" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"league_kind" text GENERATED ALWAYS AS ('league') STORED NOT NULL,
	"school_id" text NOT NULL,
	"school_kind" text GENERATED ALWAYS AS ('school') STORED NOT NULL,
	"status" text NOT NULL,
	"invited_by_user_id" text NOT NULL,
	"invited_at" timestamp with time zone NOT NULL,
	"joined_by_user_id" text,
	"joined_at" timestamp with time zone,
	"ended_by_user_id" text,
	"ended_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tournament_rating_snapshots" (
	"lobby_id" text PRIMARY KEY,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "fixture_id" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "notification_lobby_id" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "tab_command_id" text;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "league_ladder_id" text;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "league_ladder_id" text;--> statement-breakpoint
ALTER TABLE "ladders" ADD CONSTRAINT "ladders_id_lobby_unique" UNIQUE("id","lobby_id");--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_id_league_ladder_unique" UNIQUE("id","league_ladder_id");--> statement-breakpoint
CREATE UNIQUE INDEX "league_schools_open_pair_unique" ON "league_schools" ("organization_id","school_id") WHERE "status" <> 'ended';--> statement-breakpoint
CREATE INDEX "league_schools_school_idx" ON "league_schools" ("school_id","school_kind");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_fixture_command_once" ON "notifications" ("user_id","kind","fixture_id","tab_command_id");--> statement-breakpoint
CREATE INDEX "notifications_fixture_idx" ON "notifications" ("fixture_id","notification_lobby_id");--> statement-breakpoint
CREATE INDEX "notifications_lobby_idx" ON "notifications" ("notification_lobby_id");--> statement-breakpoint
CREATE INDEX "notifications_tab_command_idx" ON "notifications" ("tab_command_id","notification_lobby_id");--> statement-breakpoint
CREATE INDEX "rooms_league_ladder_lobby_idx" ON "rooms" ("league_ladder_id","lobby_id");--> statement-breakpoint
CREATE INDEX "rounds_room_league_ladder_idx" ON "rounds" ("room_id","league_ladder_id");--> statement-breakpoint
CREATE INDEX "rounds_league_ladder_completed_idx" ON "rounds" ("league_ladder_id","completed_at");--> statement-breakpoint
ALTER TABLE "league_schools" ADD CONSTRAINT "league_schools_invited_by_user_id_users_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "league_schools" ADD CONSTRAINT "league_schools_joined_by_user_id_users_id_fkey" FOREIGN KEY ("joined_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "league_schools" ADD CONSTRAINT "league_schools_ended_by_user_id_users_id_fkey" FOREIGN KEY ("ended_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "league_schools" ADD CONSTRAINT "league_schools_league_fk" FOREIGN KEY ("organization_id","league_kind") REFERENCES "organizations"("id","kind") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "league_schools" ADD CONSTRAINT "league_schools_school_fk" FOREIGN KEY ("school_id","school_kind") REFERENCES "organizations"("id","kind") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_fixture_id_fixtures_id_fkey" FOREIGN KEY ("fixture_id") REFERENCES "fixtures"("id") ON DELETE CASCADE NOT VALID;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_notification_lobby_id_lobbies_id_fkey" FOREIGN KEY ("notification_lobby_id") REFERENCES "lobbies"("id") ON DELETE CASCADE NOT VALID;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tab_command_id_action_history_command_id_fkey" FOREIGN KEY ("tab_command_id") REFERENCES "action_history"("command_id") ON DELETE CASCADE NOT VALID;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_fixture_lobby_fk" FOREIGN KEY ("fixture_id","notification_lobby_id") REFERENCES "fixtures"("id","lobby_id") ON DELETE CASCADE NOT VALID;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_command_lobby_fk" FOREIGN KEY ("tab_command_id","notification_lobby_id") REFERENCES "action_history"("command_id","lobby_id") ON DELETE CASCADE NOT VALID;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_own_league_ladder_fk" FOREIGN KEY ("league_ladder_id","lobby_id") REFERENCES "ladders"("id","lobby_id") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_room_league_ladder_fk" FOREIGN KEY ("room_id","league_ladder_id") REFERENCES "rooms"("id","league_ladder_id") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "tournament_rating_snapshots" ADD CONSTRAINT "tournament_rating_snapshots_lobby_id_tournaments_lobby_id_fkey" FOREIGN KEY ("lobby_id") REFERENCES "tournaments"("lobby_id") ON DELETE RESTRICT NOT VALID;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_league_ladder_is_casual_standing" CHECK ("league_ladder_id" is null or ("lobby_kind" = 'standing' and "competition_type" = 'casual')) NOT VALID;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_league_ladder_source_check" CHECK ("league_ladder_id" is null or ("room_id" is not null and "ladder_id" is null and "competition_type" = 'casual')) NOT VALID;--> statement-breakpoint
ALTER TABLE "settings" DROP CONSTRAINT "settings_key_check", ADD CONSTRAINT "settings_key_check" CHECK ("key" in ('pairing.preset', 'pairing.method', 'pairing.section_size', 'pairing.rematch', 'pairing.same_school', 'pairing.side_balance', 'pairing.side_alternation', 'pairing.pull_up', 'pairing.position_balance', 'pairing.section_repeat', 'pairing.preference_order', 'bye.recipient', 'bye.result', 'bye.repeat', 'judging.panel', 'judging.availability', 'judging.strike', 'judging.conflict', 'judging.same_school', 'judging.repeat_judge', 'judging.unsubmitted_ballot', 'judging.load_balance', 'judging.chair', 'judging.panel_same_school', 'judging.preference_order', 'standings.tiebreaks', 'standings.rating_ladder', 'break.line', 'break.seeding', 'break.double_qualifier', 'entry.divisions', 'entry.registration', 'entry.approval', 'entry.cap', 'entry.judge_obligation', 'conflict.handling', 'recording.capture', 'audience.posting', 'audience.decision', 'audience.scores', 'audience.reason', 'audience.feedback', 'audience.video', 'ballot.screening', 'resolution.rule', 'resolution.own_text', 'room.own_format', 'room.visibility', 'room.timing', 'room.floor', 'staff.minimum_band')) NOT VALID;
--> statement-breakpoint
ALTER TABLE "league_schools" VALIDATE CONSTRAINT "league_schools_invited_by_user_id_users_id_fkey";
--> statement-breakpoint
ALTER TABLE "league_schools" VALIDATE CONSTRAINT "league_schools_joined_by_user_id_users_id_fkey";
--> statement-breakpoint
ALTER TABLE "league_schools" VALIDATE CONSTRAINT "league_schools_ended_by_user_id_users_id_fkey";
--> statement-breakpoint
ALTER TABLE "league_schools" VALIDATE CONSTRAINT "league_schools_league_fk";
--> statement-breakpoint
ALTER TABLE "league_schools" VALIDATE CONSTRAINT "league_schools_school_fk";
--> statement-breakpoint
ALTER TABLE "notifications" VALIDATE CONSTRAINT "notifications_fixture_id_fixtures_id_fkey";
--> statement-breakpoint
ALTER TABLE "notifications" VALIDATE CONSTRAINT "notifications_notification_lobby_id_lobbies_id_fkey";
--> statement-breakpoint
ALTER TABLE "notifications" VALIDATE CONSTRAINT "notifications_tab_command_id_action_history_command_id_fkey";
--> statement-breakpoint
ALTER TABLE "notifications" VALIDATE CONSTRAINT "notifications_fixture_lobby_fk";
--> statement-breakpoint
ALTER TABLE "notifications" VALIDATE CONSTRAINT "notifications_command_lobby_fk";
--> statement-breakpoint
ALTER TABLE "rooms" VALIDATE CONSTRAINT "rooms_own_league_ladder_fk";
--> statement-breakpoint
ALTER TABLE "rounds" VALIDATE CONSTRAINT "rounds_room_league_ladder_fk";
--> statement-breakpoint
ALTER TABLE "tournament_rating_snapshots" VALIDATE CONSTRAINT "tournament_rating_snapshots_lobby_id_tournaments_lobby_id_fkey";
--> statement-breakpoint

--> statement-breakpoint

--> statement-breakpoint

--> statement-breakpoint

--> statement-breakpoint

--> statement-breakpoint

--> statement-breakpoint

--> statement-breakpoint
CREATE FUNCTION public.daisy_league_rating_selection_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.league_ladder_id IS DISTINCT FROM OLD.league_ladder_id THEN
  RAISE EXCEPTION 'A rated league selection is frozen at creation' USING ERRCODE='23514', CONSTRAINT=TG_TABLE_NAME || '_league_ladder_immutable';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER rooms_league_ladder_immutable BEFORE UPDATE OF league_ladder_id ON rooms FOR EACH ROW EXECUTE FUNCTION public.daisy_league_rating_selection_immutable();
--> statement-breakpoint
CREATE TRIGGER rounds_league_ladder_immutable BEFORE UPDATE OF league_ladder_id ON rounds FOR EACH ROW EXECUTE FUNCTION public.daisy_league_rating_selection_immutable();
--> statement-breakpoint
CREATE FUNCTION public.daisy_tournament_rating_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'A tournament rating snapshot cannot be replaced' USING ERRCODE='23514', CONSTRAINT='tournament_rating_snapshots_immutable';
END $$;
--> statement-breakpoint
CREATE TRIGGER tournament_rating_snapshots_immutable BEFORE UPDATE OR DELETE ON tournament_rating_snapshots FOR EACH ROW EXECUTE FUNCTION public.daisy_tournament_rating_snapshot_immutable();
--> statement-breakpoint
REVOKE UPDATE, DELETE ON tournament_rating_snapshots FROM daisy_web;
--> statement-breakpoint
ALTER TABLE "league_schools" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "league_schools_scope" ON "league_schools" FOR ALL USING (organization_id = daisy_organization_scope()) WITH CHECK (organization_id = daisy_organization_scope());
--> statement-breakpoint
CREATE POLICY "league_schools_counterpart" ON "league_schools" FOR SELECT USING (school_id = daisy_organization_scope());
--> statement-breakpoint
ALTER TABLE "tournament_rating_snapshots" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tournament_rating_snapshots_scope" ON "tournament_rating_snapshots" FOR ALL USING (lobby_id = daisy_lobby_scope()) WITH CHECK (lobby_id = daisy_lobby_scope());
--> statement-breakpoint

--> statement-breakpoint
ALTER TABLE "league_schools" ADD CONSTRAINT "league_schools_status_check" CHECK ("status" in ('invited', 'active', 'ended')) NOT VALID;
--> statement-breakpoint

--> statement-breakpoint
ALTER TABLE "league_schools" ADD CONSTRAINT "league_schools_state_check" CHECK (("status" = 'invited' and "joined_at" is null and "joined_by_user_id" is null and "ended_at" is null and "ended_by_user_id" is null)
    or ("status" = 'active' and "joined_at" is not null and "joined_by_user_id" is not null and "ended_at" is null and "ended_by_user_id" is null)
    or ("status" = 'ended' and ("joined_at" is null) = ("joined_by_user_id" is null) and "ended_at" is not null and "ended_by_user_id" is not null)) NOT VALID;
--> statement-breakpoint

--> statement-breakpoint
ALTER TABLE "league_schools" ADD CONSTRAINT "league_schools_time_check" CHECK (("joined_at" is null or "joined_at" >= "invited_at") and ("ended_at" is null or "ended_at" >= coalesce("joined_at", "invited_at"))) NOT VALID;
--> statement-breakpoint

--> statement-breakpoint
ALTER TABLE "league_schools" ADD CONSTRAINT "league_schools_version_positive" CHECK ("version" > 0) NOT VALID;
--> statement-breakpoint

--> statement-breakpoint
ALTER TABLE "tournament_rating_snapshots" ADD CONSTRAINT "tournament_rating_snapshots_snapshot_is_object" CHECK (jsonb_typeof("snapshot") = 'object') NOT VALID;
--> statement-breakpoint


--> statement-breakpoint
-- Preserve deployment continuity for any pre-existing exceptional row while
-- enforcing the new checks on all future writes. The populated rehearsal
-- verifies every constraint is validated for the supported historical data.
DO $$
DECLARE pending record;
BEGIN
 FOR pending IN SELECT * FROM (VALUES
      ('rooms', 'rooms_league_ladder_is_casual_standing'),
      ('rounds', 'rounds_league_ladder_source_check'),
      ('settings', 'settings_key_check'),
      ('league_schools', 'league_schools_status_check'),
      ('league_schools', 'league_schools_state_check'),
      ('league_schools', 'league_schools_time_check'),
      ('league_schools', 'league_schools_version_positive'),
      ('tournament_rating_snapshots', 'tournament_rating_snapshots_snapshot_is_object')
 ) AS added(relation, constraint_name)
 LOOP
  BEGIN
   EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', pending.relation, pending.constraint_name);
  EXCEPTION WHEN check_violation THEN
   RAISE WARNING 'constraint % on % stays NOT VALID: stored rows violate it', pending.constraint_name, pending.relation;
  END;
 END LOOP;
END $$;

--> statement-breakpoint
CREATE INDEX "league_schools_league_idx" ON "league_schools" ("organization_id","league_kind");
--> statement-breakpoint
CREATE INDEX "league_schools_invited_by_idx" ON "league_schools" ("invited_by_user_id");
--> statement-breakpoint
CREATE INDEX "league_schools_joined_by_idx" ON "league_schools" ("joined_by_user_id");
--> statement-breakpoint
CREATE INDEX "league_schools_ended_by_idx" ON "league_schools" ("ended_by_user_id");
--> statement-breakpoint
-- Each period a person was an active member: the one memberships row is
-- reopened on a rejoin, so a trigger keeps every period as its own row.
CREATE TABLE "membership_periods" (
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"joined_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "membership_periods_pkey" PRIMARY KEY("organization_id","user_id","joined_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "membership_periods_open_unique" ON "membership_periods" ("organization_id","user_id") WHERE "ended_at" is null;
--> statement-breakpoint
CREATE INDEX "membership_periods_user_idx" ON "membership_periods" ("user_id");
--> statement-breakpoint
ALTER TABLE "membership_periods" ADD CONSTRAINT "membership_periods_membership_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "memberships"("organization_id","user_id") ON DELETE CASCADE NOT VALID;
--> statement-breakpoint
ALTER TABLE "membership_periods" ADD CONSTRAINT "membership_periods_time_check" CHECK ("ended_at" is null or "ended_at" >= "joined_at") NOT VALID;
--> statement-breakpoint
INSERT INTO "membership_periods" ("organization_id","user_id","joined_at","ended_at")
SELECT "organization_id","user_id","joined_at",CASE WHEN "status" = 'ended' THEN greatest("ended_at","joined_at") ELSE NULL END
FROM "memberships" WHERE "joined_at" IS NOT NULL AND "status" IN ('active','ended');
--> statement-breakpoint
ALTER TABLE "membership_periods" VALIDATE CONSTRAINT "membership_periods_membership_fk";
--> statement-breakpoint
ALTER TABLE "membership_periods" VALIDATE CONSTRAINT "membership_periods_time_check";
--> statement-breakpoint
CREATE FUNCTION public.daisy_membership_period() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status = 'active' AND NEW.joined_at IS NOT NULL
   AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'active' OR OLD.joined_at IS DISTINCT FROM NEW.joined_at) THEN
  INSERT INTO membership_periods (organization_id, user_id, joined_at)
  VALUES (NEW.organization_id, NEW.user_id, NEW.joined_at)
  ON CONFLICT DO NOTHING;
 ELSIF TG_OP = 'UPDATE' AND OLD.status = 'active' AND NEW.status IS DISTINCT FROM 'active' THEN
  UPDATE membership_periods SET ended_at = greatest(coalesce(NEW.ended_at, now()), joined_at)
  WHERE organization_id = NEW.organization_id AND user_id = NEW.user_id AND ended_at IS NULL;
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER memberships_period AFTER INSERT OR UPDATE ON memberships FOR EACH ROW EXECUTE FUNCTION public.daisy_membership_period();
--> statement-breakpoint
REVOKE DELETE ON membership_periods FROM daisy_web;
--> statement-breakpoint
ALTER TABLE "membership_periods" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "membership_periods_scope" ON "membership_periods" FOR ALL USING (organization_id = daisy_organization_scope()) WITH CHECK (organization_id = daisy_organization_scope());
--> statement-breakpoint
CREATE POLICY "membership_periods_subject" ON "membership_periods" FOR SELECT USING (user_id = daisy_subject_scope());
