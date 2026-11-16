-- ISSUE-1409: submitted ballots are immutable; aggregate Round erasure still cascades.
CREATE FUNCTION refuse_submitted_ballot_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'A submitted ballot is immutable'
    USING ERRCODE = '23514', CONSTRAINT = 'ballots_submission_immutable';
END;
$$;
--> statement-breakpoint
-- The existing freeze trigger runs first and preserves its provenance refusal.
CREATE TRIGGER ballots_submission_immutable BEFORE UPDATE ON ballots
FOR EACH ROW EXECUTE FUNCTION refuse_submitted_ballot_update();
--> statement-breakpoint
REVOKE UPDATE, DELETE ON ballots FROM daisy_web;
--> statement-breakpoint
-- JSONB supplies canonical key ordering; the submission instant is UTC-independent.
-- SHA-256 is PostgreSQL's built-in content hash, not a secret or token comparison.
CREATE FUNCTION daisy_ballot_content_digest(ballot ballots) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT encode(sha256(convert_to(jsonb_build_object(
    'digest_version', 1,
    'ballot_id', (ballot).id,
    'judge_participant_id', (ballot).judge_participant_id,
    'round_id', (ballot).round_id,
    'freeze_revision', (ballot).freeze_revision,
    'rubric_version', (ballot).rubric_version,
    'decision', (ballot).decision,
    'winner', (ballot).winner,
    'ranking', (ballot).ranking,
    'scores', (ballot).scores,
    'reason', (ballot).reason,
    'feedback', (ballot).feedback,
    'citations', (ballot).citations,
    'ballot_definition_id', (ballot).ballot_definition_id,
    'ballot_definition_version', (ballot).ballot_definition_version,
    'submitted_at_epoch_us', floor(extract(epoch FROM (ballot).submitted_at) * 1000000)
  )::text, 'UTF8')), 'hex')
$$;
--> statement-breakpoint
ALTER TABLE round_finalization_ballots ADD COLUMN ballot_digest text;
--> statement-breakpoint
-- Every path, including direct runtime SQL, pins the actual stored content.
CREATE FUNCTION pin_finalization_ballot_digest() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  SELECT daisy_ballot_content_digest(b) INTO NEW.ballot_digest
    FROM ballots b WHERE b.id = NEW.ballot_id;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER round_finalization_ballot_digest BEFORE INSERT ON round_finalization_ballots
FOR EACH ROW EXECUTE FUNCTION pin_finalization_ballot_digest();
--> statement-breakpoint
-- The membership FK proves every source ballot exists. No payload is rewritten.
UPDATE round_finalization_ballots m SET ballot_digest = daisy_ballot_content_digest(b)
FROM ballots b WHERE b.id = m.ballot_id;
--> statement-breakpoint
SET CONSTRAINTS ALL IMMEDIATE;
--> statement-breakpoint
ALTER TABLE round_finalization_ballots ALTER COLUMN ballot_digest SET NOT NULL;
--> statement-breakpoint
ALTER TABLE round_finalization_ballots ADD CONSTRAINT round_finalization_ballots_digest_check
CHECK (ballot_digest ~ '^[a-f0-9]{64}$') NOT VALID;
--> statement-breakpoint
-- Stored data cannot make a validation refuse deployment. New writes are already checked.
DO $$
BEGIN
  ALTER TABLE round_finalization_ballots VALIDATE CONSTRAINT round_finalization_ballots_digest_check;
EXCEPTION WHEN check_violation THEN
  RAISE WARNING 'round_finalization_ballots_digest_check remains NOT VALID';
END;
$$;
--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "submitted_by_user_id" text;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_submitted_by_user_id_users_id_fkey" FOREIGN KEY ("submitted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
-- An unknown historical maker stays unknown; neither approval nor editing may invent one.
CREATE FUNCTION refuse_entry_submitter_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.submitted_by_user_id IS DISTINCT FROM OLD.submitted_by_user_id THEN
    RAISE EXCEPTION 'An entry submitter is immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'entries_submitter_immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER entries_submitter_immutable BEFORE UPDATE OF submitted_by_user_id ON entries
FOR EACH ROW EXECUTE FUNCTION refuse_entry_submitter_change();
--> statement-breakpoint
ALTER TABLE "action_history" DROP CONSTRAINT "action_history_one_tenant_key";--> statement-breakpoint
ALTER TABLE "action_history" ADD COLUMN "subject_person_user_id" text;--> statement-breakpoint
CREATE INDEX "action_history_subject_person_idx" ON "action_history" ("subject_person_user_id","applied_at");--> statement-breakpoint
ALTER TABLE "action_history" ADD CONSTRAINT "action_history_subject_person_user_id_users_id_fkey" FOREIGN KEY ("subject_person_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "action_history" ADD CONSTRAINT "action_history_one_scope" CHECK (num_nonnulls("organization_id", "lobby_id", "subject_person_user_id") = 1);
--> statement-breakpoint
DROP POLICY "action_history_scope" ON "action_history";
--> statement-breakpoint
CREATE POLICY "action_history_scope" ON "action_history" FOR ALL USING ((organization_id = daisy_organization_scope()) OR (lobby_id = daisy_lobby_scope()) OR ((subject_person_user_id = daisy_subject_scope()) AND (daisy_organization_scope() IS NULL) AND (daisy_lobby_scope() IS NULL))) WITH CHECK ((organization_id = daisy_organization_scope()) OR (lobby_id = daisy_lobby_scope()) OR ((subject_person_user_id = daisy_subject_scope()) AND (daisy_organization_scope() IS NULL) AND (daisy_lobby_scope() IS NULL)));
--> statement-breakpoint
--> statement-breakpoint
CREATE INDEX "entries_submitted_by_user_idx" ON "entries" ("submitted_by_user_id");
--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "standing_template_id" text GENERATED ALWAYS AS (case when lobby_kind = 'standing' then template_id else null end) STORED;--> statement-breakpoint
CREATE INDEX "rooms_template_idx" ON "rooms" ("template_id");--> statement-breakpoint
CREATE INDEX "rooms_standing_template_idx" ON "rooms" ("lobby_id","standing_template_id");--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_template_fk" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "rooms" DROP CONSTRAINT "rooms_offered_template_fk", ADD CONSTRAINT "rooms_offered_template_fk" FOREIGN KEY ("lobby_id","standing_template_id") REFERENCES "lobby_templates"("lobby_id","template_id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "memberships" DROP CONSTRAINT "memberships_joined_once_accepted", ADD CONSTRAINT "memberships_joined_once_accepted" CHECK (case "status"
        when 'active' then "joined_at" is not null
        when 'ended' then true
        else "joined_at" is null end);
--> statement-breakpoint
-- Before stored execution existed, a non-null judging body was the exact Daisy
-- registry definition selected at Start. Preserve its original key/revision.
UPDATE "rounds" SET "judging" = jsonb_set("judging", '{source}', jsonb_build_object(
  'kind', 'daisy', 'key', "judging"->'ballot'->>'key',
  'revision', "judging"->'ballot'->'revision'))
WHERE "judging" IS NOT NULL AND NOT ("judging" ? 'source');
--> statement-breakpoint
-- Validate any deferred row events before changing the same relation.
SET CONSTRAINTS ALL IMMEDIATE;
--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "ballot_definition_id" text GENERATED ALWAYS AS (case when judging->'source'->>'kind' = 'stored' then judging->'source'->>'id' else null end) STORED;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "ballot_definition_version" integer GENERATED ALWAYS AS (case when judging->'source'->>'kind' = 'stored' then (judging->'source'->>'version')::integer else null end) STORED;--> statement-breakpoint
CREATE INDEX "rounds_ballot_definition_idx" ON "rounds" ("ballot_definition_id","ballot_definition_version");--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_ballot_definition_fk" FOREIGN KEY ("ballot_definition_id","ballot_definition_version") REFERENCES "ballot_definition_versions"("ballot_definition_id","version") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_judging_source_check" CHECK ("judging" is null or coalesce(
        jsonb_typeof("judging"->'source') = 'object' and
        case "judging"->'source'->>'kind'
          when 'daisy' then
            "judging"->'source'->>'key' = "judging"->'ballot'->>'key' and
            "judging"->'source'->'revision' = "judging"->'ballot'->'revision' and
            (("judging"->'source'->>'key') || '@' || ("judging"->'source'->>'revision')) in ('speaker-10@1', 'speaker-10@2', 'rank-sides@1', 'rank-speakers@1')
          when 'stored' then
            "judging"->'source'->>'id' ~ '^[a-z0-9]{24}$' and
            jsonb_typeof("judging"->'source'->'version') = 'number' and
            "judging"->'source'->'version' = "judging"->'ballot'->'revision' and
            "ballot_definition_version" > 0
          else false end, false));
--> statement-breakpoint
ALTER TABLE "ballots" ADD COLUMN "speaker_ranks" jsonb;--> statement-breakpoint
ALTER TABLE "ballots" ALTER COLUMN "rubric_version" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ballots" ALTER COLUMN "reason" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ballots" ADD CONSTRAINT "ballots_speaker_ranks_check" CHECK ("speaker_ranks" is null or (jsonb_typeof("speaker_ranks") = 'array' and jsonb_array_length("speaker_ranks") > 0 and not jsonb_path_exists("speaker_ranks", 'strict $[*] ? (@.type() != "array" || @.size() == 0)') and not jsonb_path_exists("speaker_ranks", 'strict $[*][*] ? (@.type() != "string")')));--> statement-breakpoint
ALTER TABLE "ballots" DROP CONSTRAINT "ballots_daisy_definition_check", ADD CONSTRAINT "ballots_daisy_definition_check" CHECK ("ballot_definition_id" is not null or "rubric_version" in ('speaker-10@1', 'speaker-10@2', 'rank-sides@1', 'rank-speakers@1'));--> statement-breakpoint
ALTER TABLE "ballots" DROP CONSTRAINT "ballots_rubric_version_check", ADD CONSTRAINT "ballots_rubric_version_check" CHECK ("rubric_version" ~ '^[a-z][a-z0-9-]{0,39}@[1-9][0-9]*$');--> statement-breakpoint
-- Existing submissions with no speaker ranks keep byte-identical version-1 digests.
-- An enabled speaker ranking is consumed content and uses digest version 2.
CREATE OR REPLACE FUNCTION daisy_ballot_content_digest(ballot ballots) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT encode(sha256(convert_to((jsonb_build_object(
    'digest_version', 1,
    'ballot_id', (ballot).id,
    'judge_participant_id', (ballot).judge_participant_id,
    'round_id', (ballot).round_id,
    'freeze_revision', (ballot).freeze_revision,
    'rubric_version', (ballot).rubric_version,
    'decision', (ballot).decision,
    'winner', (ballot).winner,
    'ranking', (ballot).ranking,
    'scores', (ballot).scores,
    'reason', (ballot).reason,
    'feedback', (ballot).feedback,
    'citations', (ballot).citations,
    'ballot_definition_id', (ballot).ballot_definition_id,
    'ballot_definition_version', (ballot).ballot_definition_version,
    'submitted_at_epoch_us', floor(extract(epoch FROM (ballot).submitted_at) * 1000000)
  ) || CASE WHEN (ballot).speaker_ranks IS NULL THEN '{}'::jsonb
    ELSE jsonb_build_object('digest_version', 2, 'speaker_ranks', (ballot).speaker_ranks) END)::text, 'UTF8')), 'hex')
$$;
--> statement-breakpoint
ALTER TABLE "ballot_definition_versions" ADD COLUMN "copied_from_ballot_definition_id" text;--> statement-breakpoint
ALTER TABLE "ballot_definition_versions" ADD COLUMN "copied_from_ballot_definition_version" integer;--> statement-breakpoint
CREATE INDEX "ballot_definition_versions_copy_source_idx" ON "ballot_definition_versions" ("copied_from_ballot_definition_id","copied_from_ballot_definition_version");--> statement-breakpoint
ALTER TABLE "ballot_definition_versions" ADD CONSTRAINT "ballot_definition_versions_copy_source_fk" FOREIGN KEY ("copied_from_ballot_definition_id","copied_from_ballot_definition_version") REFERENCES "ballot_definition_versions"("ballot_definition_id","version") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "ballot_definition_versions" ADD CONSTRAINT "ballot_definition_versions_copy_source_complete" CHECK (("copied_from_ballot_definition_id" is null) = ("copied_from_ballot_definition_version" is null));
--> statement-breakpoint
ALTER TABLE "results" ADD COLUMN "competition_record" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "results" ADD CONSTRAINT "results_competition_record_is_object" CHECK (jsonb_typeof("competition_record") = 'object');
--> statement-breakpoint
CREATE TABLE "account_hosting_versions" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"source" text NOT NULL,
	"version" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"issuer_service_id" text,
	"issuer_operator_ref" text,
	"decision_reference" text,
	"subscription_id" text,
	"subscription_observed_at" timestamp with time zone,
	"subscription_evidence" jsonb,
	"coverage" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_hosting_versions_subject_source_version_unique" UNIQUE("user_id","source","version"),
	CONSTRAINT "account_hosting_versions_grant_identity_unique" UNIQUE("id","user_id","source"),
	CONSTRAINT "account_hosting_versions_version_positive" CHECK ("version" > 0),
	CONSTRAINT "account_hosting_versions_validity_check" CHECK (isfinite("starts_at") and isfinite("expires_at") and "starts_at" < "expires_at"),
	CONSTRAINT "account_hosting_versions_source_check" CHECK (
    ("source" = 'administrative' and "issuer_service_id" is not null and length(btrim("issuer_service_id")) between 1 and 80 and "issuer_operator_ref" is not null and "issuer_operator_ref" ~ '^[a-z0-9]{24}$'
      and "decision_reference" is not null and length(btrim("decision_reference")) between 1 and 500
      and "subscription_id" is null and "subscription_observed_at" is null and "subscription_evidence" is null)
    or ("source" = 'subscription' and "subscription_id" is not null and "subscription_observed_at" is not null and isfinite("subscription_observed_at") and "subscription_evidence" is not null
      and "issuer_service_id" is null and "issuer_operator_ref" is null and "decision_reference" is null)),
	CONSTRAINT "account_hosting_versions_paid_evidence" CHECK ("source" <> 'subscription' or coalesce(
    jsonb_typeof("subscription_evidence") = 'object'
    and "subscription_evidence"->'settlement'->>'kind' = 'paid'
    and "subscription_evidence"->'settlement'->'period'->>'subscriptionId' = "subscription_id"
    and ("subscription_evidence"->'settlement'->'period'->>'startsAt')::timestamptz <= "starts_at"
    and "expires_at" <= ("subscription_evidence"->'settlement'->'period'->>'endsAt')::timestamptz,false)),
	CONSTRAINT "account_hosting_versions_coverage_is_object" CHECK (jsonb_typeof("coverage") = 'object'),
	CONSTRAINT "account_hosting_versions_subscription_evidence_is_object" CHECK (jsonb_typeof("subscription_evidence") = 'object'),
	CONSTRAINT "account_hosting_versions_capacity_positive" CHECK (coalesce(jsonb_typeof("coverage"->'sponsorConcurrencyLimit') = 'number' and ("coverage"->>'sponsorConcurrencyLimit')::numeric > 0 and trunc(("coverage"->>'sponsorConcurrencyLimit')::numeric) = ("coverage"->>'sponsorConcurrencyLimit')::numeric and jsonb_typeof("coverage"->'tournamentConcurrencyLimit') = 'number' and ("coverage"->>'tournamentConcurrencyLimit')::numeric > 0 and trunc(("coverage"->>'tournamentConcurrencyLimit')::numeric) = ("coverage"->>'tournamentConcurrencyLimit')::numeric,false)),
	CONSTRAINT "account_hosting_versions_tournaments_array" CHECK (coalesce(jsonb_typeof("coverage"->'tournamentIds') = 'array',false))
);
--> statement-breakpoint
CREATE TABLE "tournament_capture_admissions" (
	"id" text PRIMARY KEY,
	"round_id" text NOT NULL,
	"room_id" text NOT NULL,
	"lobby_id" text NOT NULL,
	"fixture_id" text NOT NULL,
	"sponsor_user_id" text NOT NULL,
	"hosting_version_id" text NOT NULL,
	"sponsorship_version_id" text,
	"official_user_id" text NOT NULL,
	"official_actor_id" text NOT NULL,
	"command_id" text NOT NULL,
	"admission" jsonb NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tournament_capture_admissions_id_round_unique" UNIQUE("id","round_id"),
	CONSTRAINT "tournament_capture_admissions_admission_is_object" CHECK (jsonb_typeof("admission") = 'object'),
	CONSTRAINT "tournament_capture_admissions_deadline_finite" CHECK (isfinite("created_at") and isfinite("deadline_at") and "created_at"<"deadline_at" and ("settled_at" is null or (isfinite("settled_at") and "settled_at">="created_at"))),
	CONSTRAINT "tournament_capture_admissions_identity" CHECK (coalesce("admission"->>'id'="id" and "admission"->>'roundId'="round_id" and "admission"->>'roomId'="room_id" and "admission"->>'lobbyId'="lobby_id" and "admission"->>'fixtureId'="fixture_id" and "admission"->>'commandId'="command_id" and "admission"->'grant'->'hosting'->>'id'="hosting_version_id" and "admission"->'grant'->'hosting'->>'userId'="sponsor_user_id" and "admission"->'official'->>'userId'="official_user_id" and "admission"->'official'->>'actorId'="official_actor_id" and ("admission"->>'admittedAt')::timestamptz="created_at" and ("admission"->>'deadlineAt')::timestamptz="deadline_at" and case "admission"->'funding'->>'kind' when 'personal-owner' then "sponsorship_version_id" is null and "admission"->'funding'->>'ownerUserId'="sponsor_user_id" when 'organization-sponsor' then "sponsorship_version_id" is not null and "admission"->'funding'->>'sponsorshipVersionId'="sponsorship_version_id" else false end,false))
);
--> statement-breakpoint
CREATE TABLE "tournament_sponsorship_versions" (
	"id" text PRIMARY KEY,
	"lobby_id" text NOT NULL,
	"version" integer NOT NULL,
	"sponsor_user_id" text NOT NULL,
	"acted_by_user_id" text NOT NULL,
	"authority" jsonb NOT NULL,
	"kind" text NOT NULL,
	"previous_version_id" text,
	"hosting_version_id" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tournament_sponsorship_versions_id_lobby_unique" UNIQUE("id","lobby_id"),
	CONSTRAINT "tournament_sponsorship_versions_lobby_version_unique" UNIQUE("lobby_id","version"),
	CONSTRAINT "tournament_sponsorship_versions_authority_is_object" CHECK (jsonb_typeof("authority") = 'object'),
	CONSTRAINT "tournament_sponsorship_versions_version_positive" CHECK ("version">0),
	CONSTRAINT "tournament_sponsorship_versions_shape" CHECK (
  ("kind"='proposed' and "hosting_version_id" is null and "reason" is null)
  or ("kind"='active' and "previous_version_id" is not null and "hosting_version_id" is not null and "reason" is null and "acted_by_user_id"="sponsor_user_id")
  or ("kind"='revoked' and "previous_version_id" is not null and "hosting_version_id" is null and "reason" is not null and length(btrim("reason")) between 1 and 500))
);
--> statement-breakpoint
ALTER TABLE "broadcasts" ADD COLUMN "egress_dispatched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "broadcasts" ADD COLUMN "egress_settled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "account_entitlement_grants" ADD COLUMN "hosting_version_id" text;--> statement-breakpoint
ALTER TABLE "account_entitlement_grants" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "recording_captures" ADD COLUMN "egress_dispatched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "recording_captures" ADD COLUMN "egress_settled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "recordings" ADD COLUMN "tournament_admission_id" text GENERATED ALWAYS AS (case when eligibility->>'kind'='tournament_admission' then eligibility->>'admissionId' else null end) STORED;--> statement-breakpoint
CREATE INDEX "account_entitlement_grants_hosting_version_idx" ON "account_entitlement_grants" ("hosting_version_id","user_id","source");--> statement-breakpoint
CREATE INDEX "account_hosting_versions_subject_idx" ON "account_hosting_versions" ("user_id");--> statement-breakpoint
CREATE INDEX "account_hosting_versions_issuer_idx" ON "account_hosting_versions" ("issuer_service_id","issuer_operator_ref");--> statement-breakpoint
CREATE INDEX "account_hosting_versions_subscription_idx" ON "account_hosting_versions" ("subscription_id");--> statement-breakpoint
CREATE INDEX "recordings_tournament_admission_idx" ON "recordings" ("tournament_admission_id","round_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_capture_admissions_round_unique" ON "tournament_capture_admissions" ("round_id");--> statement-breakpoint
CREATE INDEX "tournament_capture_admissions_room_idx" ON "tournament_capture_admissions" ("room_id");--> statement-breakpoint
CREATE INDEX "tournament_capture_admissions_lobby_idx" ON "tournament_capture_admissions" ("lobby_id");--> statement-breakpoint
CREATE INDEX "tournament_capture_admissions_fixture_idx" ON "tournament_capture_admissions" ("fixture_id");--> statement-breakpoint
CREATE INDEX "tournament_capture_admissions_sponsor_idx" ON "tournament_capture_admissions" ("sponsor_user_id");--> statement-breakpoint
CREATE INDEX "tournament_capture_admissions_hosting_idx" ON "tournament_capture_admissions" ("hosting_version_id");--> statement-breakpoint
CREATE INDEX "tournament_capture_admissions_sponsorship_idx" ON "tournament_capture_admissions" ("sponsorship_version_id","lobby_id");--> statement-breakpoint
CREATE INDEX "tournament_capture_admissions_official_user_idx" ON "tournament_capture_admissions" ("official_user_id");--> statement-breakpoint
CREATE INDEX "tournament_capture_admissions_official_actor_idx" ON "tournament_capture_admissions" ("official_actor_id");--> statement-breakpoint
CREATE INDEX "tournament_capture_admissions_command_idx" ON "tournament_capture_admissions" ("command_id");--> statement-breakpoint
CREATE INDEX "tournament_capture_admissions_unsettled_idx" ON "tournament_capture_admissions" ("sponsor_user_id","lobby_id","round_id") WHERE "settled_at" is null;--> statement-breakpoint
CREATE INDEX "tournament_sponsorship_versions_sponsor_idx" ON "tournament_sponsorship_versions" ("sponsor_user_id");--> statement-breakpoint
CREATE INDEX "tournament_sponsorship_versions_actor_idx" ON "tournament_sponsorship_versions" ("acted_by_user_id");--> statement-breakpoint
CREATE INDEX "tournament_sponsorship_versions_previous_idx" ON "tournament_sponsorship_versions" ("previous_version_id","lobby_id");--> statement-breakpoint
CREATE INDEX "tournament_sponsorship_versions_hosting_idx" ON "tournament_sponsorship_versions" ("hosting_version_id");--> statement-breakpoint
ALTER TABLE "account_entitlement_grants" ADD CONSTRAINT "account_entitlement_grants_hosting_version_fk" FOREIGN KEY ("hosting_version_id","user_id","source") REFERENCES "account_hosting_versions"("id","user_id","source") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "account_hosting_versions" ADD CONSTRAINT "account_hosting_versions_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "account_hosting_versions" ADD CONSTRAINT "account_hosting_versions_1oapR8KN1xKl_fkey" FOREIGN KEY ("subscription_id") REFERENCES "billing_subscriptions"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_tournament_admission_fk" FOREIGN KEY ("tournament_admission_id","round_id") REFERENCES "tournament_capture_admissions"("id","round_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "tournament_capture_admissions" ADD CONSTRAINT "tournament_capture_admissions_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "tournament_capture_admissions" ADD CONSTRAINT "tournament_capture_admissions_room_id_rooms_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "tournament_capture_admissions" ADD CONSTRAINT "tournament_capture_admissions_Hp6ysWVwtZpm_fkey" FOREIGN KEY ("lobby_id") REFERENCES "tournaments"("lobby_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "tournament_capture_admissions" ADD CONSTRAINT "tournament_capture_admissions_fixture_id_fixtures_id_fkey" FOREIGN KEY ("fixture_id") REFERENCES "fixtures"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "tournament_capture_admissions" ADD CONSTRAINT "tournament_capture_admissions_sponsor_user_id_users_id_fkey" FOREIGN KEY ("sponsor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "tournament_capture_admissions" ADD CONSTRAINT "tournament_capture_admissions_ntoOcmJYNT6m_fkey" FOREIGN KEY ("hosting_version_id") REFERENCES "account_hosting_versions"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "tournament_capture_admissions" ADD CONSTRAINT "tournament_capture_admissions_official_user_id_users_id_fkey" FOREIGN KEY ("official_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "tournament_capture_admissions" ADD CONSTRAINT "tournament_capture_admissions_official_actor_id_actors_id_fkey" FOREIGN KEY ("official_actor_id") REFERENCES "actors"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "tournament_capture_admissions" ADD CONSTRAINT "tournament_capture_admissions_O09rYLhl39Tq_fkey" FOREIGN KEY ("command_id") REFERENCES "room_commands"("command_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "tournament_capture_admissions" ADD CONSTRAINT "tournament_capture_admissions_sponsorship_fk" FOREIGN KEY ("sponsorship_version_id","lobby_id") REFERENCES "tournament_sponsorship_versions"("id","lobby_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "tournament_sponsorship_versions" ADD CONSTRAINT "tournament_sponsorship_versions_7deek4FeAvin_fkey" FOREIGN KEY ("lobby_id") REFERENCES "tournaments"("lobby_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "tournament_sponsorship_versions" ADD CONSTRAINT "tournament_sponsorship_versions_sponsor_user_id_users_id_fkey" FOREIGN KEY ("sponsor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "tournament_sponsorship_versions" ADD CONSTRAINT "tournament_sponsorship_versions_acted_by_user_id_users_id_fkey" FOREIGN KEY ("acted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "tournament_sponsorship_versions" ADD CONSTRAINT "tournament_sponsorship_versions_7Mf0YBGm6Mtn_fkey" FOREIGN KEY ("hosting_version_id") REFERENCES "account_hosting_versions"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "tournament_sponsorship_versions" ADD CONSTRAINT "tournament_sponsorship_versions_previous_fk" FOREIGN KEY ("previous_version_id","lobby_id") REFERENCES "tournament_sponsorship_versions"("id","lobby_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "account_entitlement_grants" ADD CONSTRAINT "account_entitlement_grants_revocation_finite" CHECK ("revoked_at" is null or isfinite("revoked_at"));--> statement-breakpoint
ALTER TABLE "account_entitlement_grants" DROP CONSTRAINT "account_entitlement_grants_validity_check", ADD CONSTRAINT "account_entitlement_grants_validity_check" CHECK (
      ("entitlement" = 'tournament_hosting' and "source" in ('administrative', 'subscription') and "hosting_version_id" is not null and "starts_at" is null and "expires_at" is null)
      or ("entitlement" <> 'tournament_hosting' and "hosting_version_id" is null and (( "source" = 'beta' and "starts_at" is null and "expires_at" is null)
      or ("source" = 'subscription' and "starts_at" is not null and "expires_at" is not null
        and isfinite("starts_at") and isfinite("expires_at") and "starts_at" < "expires_at")))
    );--> statement-breakpoint
ALTER TABLE "account_entitlement_grants" DROP CONSTRAINT "account_entitlement_grants_entitlement_check", ADD CONSTRAINT "account_entitlement_grants_entitlement_check" CHECK ("entitlement" in ('round_analysis', 'ai_rounds', 'casual_ai_judge', 'casual_capture', 'recording_download', 'tournament_hosting'));--> statement-breakpoint
ALTER TABLE "account_entitlement_grants" DROP CONSTRAINT "account_entitlement_grants_source_check", ADD CONSTRAINT "account_entitlement_grants_source_check" CHECK ("source" in ('beta', 'subscription', 'administrative'));--> statement-breakpoint
-- Participant app reads hosting; issuance remains an administrative boundary.
REVOKE INSERT, UPDATE, DELETE ON account_hosting_versions FROM daisy_web;
--> statement-breakpoint
CREATE FUNCTION daisy_hosting_version_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Hosting grant versions are immutable'
    USING ERRCODE='23514', CONSTRAINT='account_hosting_versions_immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER account_hosting_versions_immutable BEFORE UPDATE ON account_hosting_versions
  FOR EACH ROW EXECUTE FUNCTION daisy_hosting_version_immutable();
--> statement-breakpoint
CREATE FUNCTION daisy_hosting_grant_issuance_boundary() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.entitlement = 'tournament_hosting' AND current_user = 'daisy_web' THEN
    RAISE EXCEPTION 'Hosting issuance requires the administrative boundary'
      USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER account_hosting_grant_issuance_boundary BEFORE INSERT OR UPDATE ON account_entitlement_grants
  FOR EACH ROW EXECUTE FUNCTION daisy_hosting_grant_issuance_boundary();
--> statement-breakpoint
CREATE FUNCTION daisy_verify_hosting_subscription_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source = 'subscription' AND NOT EXISTS (
    SELECT 1 FROM billing_subscriptions s WHERE s.id=NEW.subscription_id AND s.user_id=NEW.user_id
      AND s.observed_at=NEW.subscription_observed_at AND s.evidence=NEW.subscription_evidence
  ) THEN
    RAISE EXCEPTION 'Hosting subscription provenance does not match its account observation'
      USING ERRCODE='23514', CONSTRAINT='account_hosting_versions_verified_subscription';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER account_hosting_versions_verified_subscription BEFORE INSERT ON account_hosting_versions
  FOR EACH ROW EXECUTE FUNCTION daisy_verify_hosting_subscription_source();

--> statement-breakpoint
ALTER TABLE "tournament_sponsorship_versions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tournament_sponsorship_versions_scope" ON "tournament_sponsorship_versions" FOR ALL USING (lobby_id = daisy_lobby_scope()) WITH CHECK (lobby_id = daisy_lobby_scope());
--> statement-breakpoint
CREATE FUNCTION daisy_tournament_sponsorship_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Tournament sponsorship versions are immutable'
    USING ERRCODE='23514', CONSTRAINT='tournament_sponsorship_versions_immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER tournament_sponsorship_versions_immutable BEFORE UPDATE OR DELETE ON tournament_sponsorship_versions
  FOR EACH ROW EXECUTE FUNCTION daisy_tournament_sponsorship_immutable();
--> statement-breakpoint
CREATE FUNCTION daisy_tournament_sponsorship_chain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous public.tournament_sponsorship_versions%ROWTYPE;
BEGIN
  SELECT * INTO previous FROM public.tournament_sponsorship_versions WHERE lobby_id=NEW.lobby_id ORDER BY version DESC LIMIT 1;
  IF NEW.version IS DISTINCT FROM coalesce(previous.version,0)+1
    OR NEW.previous_version_id IS DISTINCT FROM previous.id
    OR (NEW.kind <> 'proposed' AND NEW.sponsor_user_id IS DISTINCT FROM previous.sponsor_user_id)
    OR (NEW.kind = 'active' AND previous.kind IS DISTINCT FROM 'proposed') THEN
    RAISE EXCEPTION 'Sponsorship must advance its actual current version'
      USING ERRCODE='23514', CONSTRAINT='tournament_sponsorship_versions_chain';
  END IF;
  IF NEW.kind='active' AND NOT EXISTS (
    SELECT 1 FROM public.account_hosting_versions v
    JOIN public.account_entitlement_grants g ON g.hosting_version_id=v.id AND g.user_id=v.user_id AND g.source=v.source
    WHERE v.id=NEW.hosting_version_id AND v.user_id=NEW.sponsor_user_id AND g.entitlement='tournament_hosting'
      AND g.revoked_at IS NULL AND v.starts_at<=NEW.created_at AND NEW.created_at<v.expires_at
      AND v.coverage->'tournamentIds' ? NEW.lobby_id
  ) THEN
    RAISE EXCEPTION 'Consent must name the funding account current covered source'
      USING ERRCODE='23514', CONSTRAINT='tournament_sponsorship_versions_current_coverage';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER tournament_sponsorship_versions_chain BEFORE INSERT ON tournament_sponsorship_versions
  FOR EACH ROW EXECUTE FUNCTION daisy_tournament_sponsorship_chain();

--> statement-breakpoint
REVOKE UPDATE, DELETE ON tournament_sponsorship_versions FROM daisy_web;
--> statement-breakpoint
CREATE FUNCTION public.daisy_erase_unused_hosting_versions(subject_user_id text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  PERFORM 1 FROM public.users WHERE id=subject_user_id AND deleted_at IS NOT NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Hosting cleanup requires the closed subject' USING ERRCODE='42501'; END IF;
  DELETE FROM public.account_hosting_versions v WHERE v.user_id=subject_user_id
    AND NOT EXISTS (SELECT 1 FROM public.account_entitlement_grants g WHERE g.hosting_version_id=v.id)
    AND NOT EXISTS (SELECT 1 FROM public.tournament_sponsorship_versions s WHERE s.hosting_version_id=v.id);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_erase_unused_hosting_versions(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_erase_unused_hosting_versions(text) TO daisy_web;

--> statement-breakpoint
ALTER TABLE "tournament_capture_admissions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tournament_capture_admissions_scope" ON "tournament_capture_admissions" FOR ALL USING (lobby_id = daisy_lobby_scope()) WITH CHECK (lobby_id = daisy_lobby_scope());
--> statement-breakpoint
REVOKE UPDATE, DELETE ON tournament_capture_admissions FROM daisy_web;
--> statement-breakpoint
CREATE FUNCTION public.daisy_nonranked_capture_capacity(excluded_round_id text,host_actor_id text,funding_user_id text,tournament_lobby_id text)
RETURNS TABLE(running integer,hosted integer,sponsored integer,tournament integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 WITH held AS (
  SELECT r.id FROM public.rounds r WHERE r.competition_type<>'ranked' AND r.status IN ('opening','active')
   AND (r.capture->>'recordingPolicy' IN ('officials','released') OR r.capture->'broadcast'<>'null'::jsonb)
   AND NOT EXISTS (SELECT 1 FROM public.tournament_capture_admissions a WHERE a.round_id=r.id)
  UNION
  SELECT c.round_id FROM public.recording_captures c JOIN public.rounds r ON r.id=c.round_id
   WHERE r.competition_type<>'ranked' AND (c.egress_id IS NOT NULL OR c.egress_dispatched_at IS NOT NULL) AND (c.egress_settled_at IS NULL OR c.observer_revoked_at IS NULL)
  UNION
  SELECT b.round_id FROM public.broadcasts b JOIN public.rounds r ON r.id=b.round_id
   WHERE r.competition_type<>'ranked' AND (b.egress_id IS NOT NULL OR b.egress_dispatched_at IS NOT NULL) AND (b.egress_settled_at IS NULL OR b.observer_revoked_at IS NULL)
  UNION
  SELECT a.round_id FROM public.tournament_capture_admissions a WHERE a.settled_at IS NULL
 )
 SELECT count(*)::integer,(count(*) FILTER (WHERE r.created_by_actor_id=host_actor_id))::integer,
  (SELECT count(*)::integer FROM public.tournament_capture_admissions a WHERE a.sponsor_user_id=funding_user_id AND a.settled_at IS NULL AND a.round_id<>excluded_round_id),
  (SELECT count(*)::integer FROM public.tournament_capture_admissions a WHERE a.lobby_id=tournament_lobby_id AND a.settled_at IS NULL AND a.round_id<>excluded_round_id)
 FROM held h JOIN public.rounds r ON r.id=h.id WHERE h.id<>excluded_round_id;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_nonranked_capture_capacity(text,text,text,text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_nonranked_capture_capacity(text,text,text,text) TO daisy_web;
--> statement-breakpoint
CREATE FUNCTION public.daisy_recording_tournament_admission(target_round_id text)
RETURNS TABLE("admissionId" text,"roundId" text,"deadlineAt" timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT a.id,a.round_id,a.deadline_at FROM public.tournament_capture_admissions a WHERE a.round_id=target_round_id AND a.settled_at IS NULL;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_recording_tournament_admission(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_recording_tournament_admission(text) TO daisy_web;
--> statement-breakpoint
CREATE FUNCTION public.daisy_tournament_capture_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-'settled_at') IS DISTINCT FROM (to_jsonb(OLD)-'settled_at')
  OR OLD.settled_at IS NOT NULL THEN
  RAISE EXCEPTION 'Tournament capture admission is immutable' USING ERRCODE='23514', CONSTRAINT='tournament_capture_admissions_immutable';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER tournament_capture_admissions_immutable BEFORE UPDATE OR DELETE ON tournament_capture_admissions
 FOR EACH ROW EXECUTE FUNCTION public.daisy_tournament_capture_immutable();
--> statement-breakpoint
CREATE FUNCTION public.daisy_tournament_capture_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM public.rounds r JOIN public.rooms room ON room.id=r.room_id
  JOIN public.fixtures f ON f.room_id=room.id AND f.lobby_id=room.lobby_id
  JOIN public.room_commands c ON c.room_id=room.id
  JOIN public.actors actor ON actor.id=NEW.official_actor_id AND actor.user_id=NEW.official_user_id
  WHERE r.id=NEW.round_id AND r.room_id=NEW.room_id AND room.host_actor_id IS NULL AND r.created_by_actor_id IS NULL
   AND room.lobby_id=NEW.lobby_id AND f.id=NEW.fixture_id AND f.status='published'
   AND f.event_id=NEW.admission->>'eventId'
   AND c.command_id=NEW.command_id AND c.actor_id=NEW.official_actor_id AND c.type='start-round'
 ) OR NOT EXISTS (
  SELECT 1 FROM public.account_hosting_versions v JOIN public.account_entitlement_grants g
   ON g.hosting_version_id=v.id AND g.user_id=v.user_id AND g.source=v.source
  WHERE v.id=NEW.hosting_version_id AND v.user_id=NEW.sponsor_user_id AND g.revoked_at IS NULL
   AND g.entitlement='tournament_hosting' AND v.starts_at<=NEW.created_at AND NEW.created_at<v.expires_at
   AND NEW.deadline_at<=v.expires_at AND v.coverage->'tournamentIds' ? NEW.lobby_id
   AND NEW.admission->'grant'->'hosting'->'coverage'=v.coverage AND NEW.admission->'grant'->>'source'=v.source
 ) THEN
  RAISE EXCEPTION 'Capture admission requires its actual current Round, receipt and covered source'
   USING ERRCODE='23514', CONSTRAINT='tournament_capture_admissions_source';
 END IF;
 IF NOT EXISTS (
  SELECT 1 FROM public.lobbies l WHERE l.id=NEW.lobby_id AND l.kind='tournament' AND l.closed_at IS NULL AND
   ((NEW.sponsorship_version_id IS NULL AND l.owner_user_id=NEW.sponsor_user_id)
    OR (l.owner_organization_id IS NOT NULL AND NEW.admission->'funding'->>'organizationId'=l.owner_organization_id AND EXISTS (
      SELECT 1 FROM public.tournament_sponsorship_versions s WHERE s.id=NEW.sponsorship_version_id
       AND s.lobby_id=l.id AND s.sponsor_user_id=NEW.sponsor_user_id AND s.hosting_version_id=NEW.hosting_version_id AND s.kind='active'
       AND NOT EXISTS(SELECT 1 FROM public.tournament_sponsorship_versions later WHERE later.lobby_id=l.id AND later.version>s.version)
    )))
 ) THEN
  RAISE EXCEPTION 'Capture funding requires the actual owner or current dual-consented sponsorship'
   USING ERRCODE='23514', CONSTRAINT='tournament_capture_admissions_funding';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER tournament_capture_admissions_source BEFORE INSERT ON tournament_capture_admissions
 FOR EACH ROW EXECUTE FUNCTION public.daisy_tournament_capture_source();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.daisy_erase_unused_hosting_versions(subject_user_id text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM 1 FROM public.users WHERE id=subject_user_id AND deleted_at IS NOT NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Hosting cleanup requires the closed subject' USING ERRCODE='42501'; END IF;
 DELETE FROM public.account_hosting_versions v WHERE v.user_id=subject_user_id
  AND NOT EXISTS(SELECT 1 FROM public.account_entitlement_grants g WHERE g.hosting_version_id=v.id)
  AND NOT EXISTS(SELECT 1 FROM public.tournament_sponsorship_versions s WHERE s.hosting_version_id=v.id)
  AND NOT EXISTS(SELECT 1 FROM public.tournament_capture_admissions a WHERE a.hosting_version_id=v.id);
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.daisy_lock_recording_tournament_admission(target_round_id text)
RETURNS TABLE("admissionId" text,"roundId" text,"deadlineAt" timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 RETURN QUERY SELECT a.id,a.round_id,a.deadline_at FROM public.tournament_capture_admissions a WHERE a.round_id=target_round_id FOR UPDATE;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_lock_recording_tournament_admission(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_lock_recording_tournament_admission(text) TO daisy_web;
--> statement-breakpoint
CREATE FUNCTION public.daisy_recording_settle_tournament_admission(target_round_id text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE admission public.tournament_capture_admissions%ROWTYPE;
BEGIN
 SELECT * INTO admission FROM public.tournament_capture_admissions WHERE round_id=target_round_id FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF admission.settled_at IS NOT NULL THEN RETURN true; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.recording_captures c WHERE c.round_id=target_round_id
   AND c.ended_at IS NOT NULL AND c.observer_revoked_at IS NOT NULL
   AND (c.egress_settled_at IS NOT NULL OR (c.egress_id IS NULL AND c.egress_dispatched_at IS NULL))) THEN RETURN false; END IF;
 UPDATE public.tournament_capture_admissions SET settled_at=clock_timestamp() WHERE id=admission.id;
 RETURN true;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_recording_settle_tournament_admission(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_recording_settle_tournament_admission(text) TO daisy_web;

--> statement-breakpoint
CREATE FUNCTION public.daisy_recording_source_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.round_id IS DISTINCT FROM OLD.round_id OR NEW.eligibility IS DISTINCT FROM OLD.eligibility OR NEW.recording_class IS DISTINCT FROM OLD.recording_class THEN
  RAISE EXCEPTION 'Recording source provenance is immutable' USING ERRCODE='23514', CONSTRAINT='recordings_source_immutable';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER recordings_source_immutable BEFORE UPDATE ON recordings FOR EACH ROW EXECUTE FUNCTION public.daisy_recording_source_immutable();
--> statement-breakpoint
CREATE FUNCTION public.daisy_recording_expired_tournament_admissions(batch_limit integer)
RETURNS TABLE("roundId" text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT a.round_id FROM public.tournament_capture_admissions a
 WHERE a.settled_at IS NULL AND a.deadline_at<=clock_timestamp()
 ORDER BY a.deadline_at,a.round_id LIMIT least(greatest(batch_limit,0),100);
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_recording_expired_tournament_admissions(integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_recording_expired_tournament_admissions(integer) TO daisy_web;
--> statement-breakpoint
CREATE FUNCTION public.daisy_recording_settle_undispatched_tournament_admission(target_round_id text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE admission public.tournament_capture_admissions%ROWTYPE;
BEGIN
 SELECT * INTO admission FROM public.tournament_capture_admissions WHERE round_id=target_round_id FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF admission.settled_at IS NOT NULL THEN RETURN true; END IF;
 IF clock_timestamp()<admission.deadline_at OR EXISTS(
  SELECT 1 FROM public.recording_captures c WHERE c.round_id=target_round_id
   AND (c.egress_dispatched_at IS NOT NULL OR c.egress_id IS NOT NULL)
 ) THEN RETURN false; END IF;
 -- Holding the same admission lock as dispatch, after its finite deadline,
 -- proves no call was dispatched and no future dispatch can pass its gate.
 UPDATE public.tournament_capture_admissions SET settled_at=clock_timestamp() WHERE id=admission.id;
 RETURN true;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_recording_settle_undispatched_tournament_admission(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_recording_settle_undispatched_tournament_admission(text) TO daisy_web;

--> statement-breakpoint
CREATE POLICY "tournament_sponsorship_versions_subject" ON "tournament_sponsorship_versions" FOR SELECT USING (sponsor_user_id = daisy_subject_scope() OR acted_by_user_id = daisy_subject_scope());
--> statement-breakpoint
CREATE POLICY "tournament_capture_admissions_subject" ON "tournament_capture_admissions" FOR SELECT USING (sponsor_user_id = daisy_subject_scope() OR official_user_id = daisy_subject_scope());
--> statement-breakpoint
CREATE INDEX "tournament_capture_admissions_expired_idx" ON "tournament_capture_admissions" ("deadline_at","round_id") WHERE "settled_at" is null;
--> statement-breakpoint
CREATE INDEX "broadcasts_physical_unsettled_idx" ON "broadcasts" ("round_id") WHERE ("egress_id" is not null or "egress_dispatched_at" is not null) and ("egress_settled_at" is null or "observer_revoked_at" is null);--> statement-breakpoint
CREATE INDEX "recording_captures_physical_unsettled_idx" ON "recording_captures" ("round_id") WHERE ("egress_id" is not null or "egress_dispatched_at" is not null) and ("egress_settled_at" is null or "observer_revoked_at" is null);
--> statement-breakpoint
CREATE TABLE "fixture_room_sources" (
	"room_id" text PRIMARY KEY,
	"fixture_id" text NOT NULL,
	"lobby_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "fixture_room_sources_fixture_idx" ON "fixture_room_sources" ("fixture_id","lobby_id");--> statement-breakpoint
CREATE INDEX "fixture_room_sources_room_lobby_idx" ON "fixture_room_sources" ("room_id","lobby_id");--> statement-breakpoint
CREATE INDEX "fixture_room_sources_lobby_idx" ON "fixture_room_sources" ("lobby_id");--> statement-breakpoint
ALTER TABLE "fixture_room_sources" ADD CONSTRAINT "fixture_room_sources_fixture_fk" FOREIGN KEY ("fixture_id","lobby_id") REFERENCES "fixtures"("id","lobby_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "fixture_room_sources" ADD CONSTRAINT "fixture_room_sources_room_fk" FOREIGN KEY ("room_id","lobby_id") REFERENCES "rooms"("id","lobby_id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE public.fixture_room_sources ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY fixture_room_sources_scope ON public.fixture_room_sources FOR ALL
 USING (lobby_id=daisy_lobby_scope()) WITH CHECK (lobby_id=daisy_lobby_scope());
--> statement-breakpoint
-- This copies only the existing real foreign-key relationship, not a reconstructed command history.
INSERT INTO public.fixture_room_sources(room_id,fixture_id,lobby_id)
 SELECT room_id,id,lobby_id FROM public.fixtures WHERE room_id IS NOT NULL;
--> statement-breakpoint
REVOKE INSERT,UPDATE,DELETE ON public.fixture_room_sources FROM daisy_web;
--> statement-breakpoint
CREATE FUNCTION public.daisy_fixture_room_source_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'A fixture Room source cannot be rewritten'
 USING ERRCODE='23514',CONSTRAINT='fixture_room_sources_immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER fixture_room_sources_immutable BEFORE UPDATE OR DELETE ON public.fixture_room_sources
 FOR EACH ROW EXECUTE FUNCTION public.daisy_fixture_room_source_immutable();
--> statement-breakpoint
CREATE FUNCTION public.daisy_record_fixture_room_source() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NEW.room_id IS NULL THEN RETURN NEW; END IF;
 INSERT INTO public.fixture_room_sources(room_id,fixture_id,lobby_id)
 VALUES(NEW.room_id,NEW.id,NEW.lobby_id) ON CONFLICT(room_id) DO NOTHING;
 IF NOT EXISTS(SELECT 1 FROM public.fixture_room_sources
  WHERE room_id=NEW.room_id AND fixture_id=NEW.id AND lobby_id=NEW.lobby_id) THEN
  RAISE EXCEPTION 'A Room cannot acquire another fixture source'
   USING ERRCODE='23514',CONSTRAINT='fixture_room_sources_original_fixture';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_record_fixture_room_source() FROM PUBLIC,daisy_web;
--> statement-breakpoint
CREATE TRIGGER fixtures_record_room_source AFTER INSERT OR UPDATE OF room_id ON public.fixtures
 FOR EACH ROW EXECUTE FUNCTION public.daisy_record_fixture_room_source();
--> statement-breakpoint
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_tournament_deadline_shape" CHECK (coalesce("eligibility"->>'kind'<>'tournament_admission' or jsonb_typeof("eligibility"->'deadlineAt')='string',false));--> statement-breakpoint
-- The immutable Recording pin must name the actual finite obligation, not merely a real admission id.
CREATE FUNCTION public.daisy_recording_admission_deadline() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NEW.eligibility->>'kind'='tournament_admission' AND NOT EXISTS (
  SELECT 1 FROM public.tournament_capture_admissions a
  WHERE a.id=(NEW.eligibility->>'admissionId') AND a.round_id=NEW.round_id
   AND isfinite((NEW.eligibility->>'deadlineAt')::timestamptz)
   AND a.deadline_at=(NEW.eligibility->>'deadlineAt')::timestamptz
 ) THEN
  RAISE EXCEPTION 'Recording deadline must match its actual admission'
   USING ERRCODE='23514',CONSTRAINT='recordings_admission_deadline';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_recording_admission_deadline() FROM PUBLIC,daisy_web;
--> statement-breakpoint
CREATE TRIGGER recordings_admission_deadline BEFORE INSERT ON public.recordings
 FOR EACH ROW EXECUTE FUNCTION public.daisy_recording_admission_deadline();
--> statement-breakpoint
CREATE TABLE "round_finalization_judge_assignments" (
	"round_id" text,
	"slot" integer,
	"assignment_version" integer,
	"participant_id" text,
	CONSTRAINT "round_finalization_judge_assignments_pkey" PRIMARY KEY("round_id","slot"),
	CONSTRAINT "round_finalization_judge_assignments_participant_unique" UNIQUE("round_id","participant_id"),
	CONSTRAINT "round_finalization_judge_assignments_slot_check" CHECK ("slot">=0 and ("assignment_version" is null or "assignment_version">0) and ("assignment_version" is not null or "participant_id" is null))
);
--> statement-breakpoint
CREATE TABLE "round_judge_assignments" (
	"round_id" text,
	"slot" integer,
	"version" integer,
	"previous_version" integer GENERATED ALWAYS AS (case when version>1 then version-1 else null end) STORED,
	"participant_id" text,
	"actor_id" text,
	"source" text NOT NULL,
	"command_id" text,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "round_judge_assignments_pkey" PRIMARY KEY("round_id","slot","version"),
	CONSTRAINT "round_judge_assignments_occupant_unique" UNIQUE("round_id","slot","version","participant_id","actor_id"),
	CONSTRAINT "round_judge_assignments_participant_unique" UNIQUE("round_id","slot","version","participant_id"),
	CONSTRAINT "round_judge_assignments_version_check" CHECK ("slot">=0 and "version">0),
	CONSTRAINT "round_judge_assignments_occupant_check" CHECK (("participant_id" is null)=("actor_id" is null)),
	CONSTRAINT "round_judge_assignments_source_check" CHECK ("source" in ('initial','observed','command') and ("command_id" is not null)=("source"='command') and ("source"='command' or "version"=1) and isfinite("recorded_at"))
);
--> statement-breakpoint
CREATE TABLE "round_judge_slots" (
	"round_id" text,
	"slot" integer,
	"current_version" integer,
	"participant_id" text,
	"actor_id" text,
	CONSTRAINT "round_judge_slots_pkey" PRIMARY KEY("round_id","slot"),
	CONSTRAINT "round_judge_slots_slot_check" CHECK ("slot">=0),
	CONSTRAINT "round_judge_slots_version_check" CHECK ("current_version" is null or "current_version">0),
	CONSTRAINT "round_judge_slots_occupant_check" CHECK (("participant_id" is null)=("actor_id" is null) and ("current_version" is not null or "participant_id" is null))
);
--> statement-breakpoint
CREATE TABLE "round_source_voids" (
	"round_id" text PRIMARY KEY,
	"command_id" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	CONSTRAINT "round_source_voids_time_check" CHECK (isfinite("recorded_at"))
);
--> statement-breakpoint
ALTER TABLE "round_participants" DROP CONSTRAINT "round_participants_seat_unique";--> statement-breakpoint
ALTER TABLE "rating_changes" DROP CONSTRAINT "rating_changes_participant_fk";--> statement-breakpoint
DROP INDEX "round_participants_actor_unique";--> statement-breakpoint
ALTER TABLE "round_participants" ADD COLUMN "rating_actor_id" text GENERATED ALWAYS AS (case when seat_kind in ('side','speaker') then actor_id else null end) STORED;--> statement-breakpoint
ALTER TABLE "round_participants" ADD CONSTRAINT "round_participants_assignment_identity_unique" UNIQUE("id","round_id","slot","actor_id");--> statement-breakpoint
CREATE INDEX "round_finalization_judge_assignments_version_idx" ON "round_finalization_judge_assignments" ("round_id","slot","assignment_version","participant_id");--> statement-breakpoint
CREATE INDEX "round_judge_assignments_participant_idx" ON "round_judge_assignments" ("participant_id","round_id","slot","actor_id");--> statement-breakpoint
CREATE INDEX "round_judge_assignments_previous_idx" ON "round_judge_assignments" ("round_id","slot","previous_version");--> statement-breakpoint
CREATE INDEX "round_judge_assignments_actor_idx" ON "round_judge_assignments" ("actor_id","round_id");--> statement-breakpoint
CREATE INDEX "round_judge_assignments_command_idx" ON "round_judge_assignments" ("command_id","round_id");--> statement-breakpoint
CREATE INDEX "round_judge_slots_assignment_idx" ON "round_judge_slots" ("round_id","slot","current_version","participant_id","actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "round_judge_slots_current_actor_unique" ON "round_judge_slots" ("round_id","actor_id") WHERE "actor_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "round_judge_slots_current_participant_unique" ON "round_judge_slots" ("participant_id") WHERE "participant_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "round_participants_fixed_actor_unique" ON "round_participants" ("round_id","actor_id") WHERE "seat_kind"<>'judge';--> statement-breakpoint
CREATE UNIQUE INDEX "round_participants_rating_actor_unique" ON "round_participants" ("round_id","rating_actor_id");--> statement-breakpoint
CREATE INDEX "round_participants_round_actor_idx" ON "round_participants" ("round_id","actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "round_participants_fixed_seat_unique" ON "round_participants" ("round_id","seat_kind",coalesce("side",''),"slot") WHERE "seat_kind"<>'judge';--> statement-breakpoint
CREATE INDEX "round_source_voids_command_idx" ON "round_source_voids" ("command_id","round_id");--> statement-breakpoint
ALTER TABLE "round_finalization_judge_assignments" ADD CONSTRAINT "round_finalization_judge_assignments_0bD8W7xwSyhz_fkey" FOREIGN KEY ("round_id") REFERENCES "round_finalizations"("round_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "round_finalization_judge_assignments" ADD CONSTRAINT "round_finalization_judge_assignments_version_fk" FOREIGN KEY ("round_id","slot","assignment_version") REFERENCES "round_judge_assignments"("round_id","slot","version");--> statement-breakpoint
ALTER TABLE "round_finalization_judge_assignments" ADD CONSTRAINT "round_finalization_judge_assignments_occupant_fk" FOREIGN KEY ("round_id","slot","assignment_version","participant_id") REFERENCES "round_judge_assignments"("round_id","slot","version","participant_id");--> statement-breakpoint
ALTER TABLE "round_judge_assignments" ADD CONSTRAINT "round_judge_assignments_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "round_judge_assignments" ADD CONSTRAINT "round_judge_assignments_slot_fk" FOREIGN KEY ("round_id","slot") REFERENCES "round_judge_slots"("round_id","slot") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "round_judge_assignments" ADD CONSTRAINT "round_judge_assignments_previous_fk" FOREIGN KEY ("round_id","slot","previous_version") REFERENCES "round_judge_assignments"("round_id","slot","version");--> statement-breakpoint
ALTER TABLE "round_judge_assignments" ADD CONSTRAINT "round_judge_assignments_identity_fk" FOREIGN KEY ("participant_id","round_id","slot","actor_id") REFERENCES "round_participants"("id","round_id","slot","actor_id");--> statement-breakpoint
ALTER TABLE "round_judge_assignments" ADD CONSTRAINT "round_judge_assignments_command_fk" FOREIGN KEY ("command_id","round_id") REFERENCES "round_commands"("command_id","round_id");--> statement-breakpoint
ALTER TABLE "round_judge_slots" ADD CONSTRAINT "round_judge_slots_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "round_judge_slots" ADD CONSTRAINT "round_judge_slots_assignment_fk" FOREIGN KEY ("round_id","slot","current_version") REFERENCES "round_judge_assignments"("round_id","slot","version");--> statement-breakpoint
ALTER TABLE "round_judge_slots" ADD CONSTRAINT "round_judge_slots_occupant_fk" FOREIGN KEY ("round_id","slot","current_version","participant_id","actor_id") REFERENCES "round_judge_assignments"("round_id","slot","version","participant_id","actor_id");--> statement-breakpoint
ALTER TABLE "round_source_voids" ADD CONSTRAINT "round_source_voids_round_id_rounds_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "round_source_voids" ADD CONSTRAINT "round_source_voids_command_fk" FOREIGN KEY ("command_id","round_id") REFERENCES "round_commands"("command_id","round_id");--> statement-breakpoint
ALTER TABLE "rating_changes" ADD CONSTRAINT "rating_changes_participant_fk" FOREIGN KEY ("round_id","actor_id") REFERENCES "round_participants"("round_id","rating_actor_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "round_commands" DROP CONSTRAINT "round_commands_type_check", ADD CONSTRAINT "round_commands_type_check" CHECK ("type" in ('start', 'strike_resolution', 'start_prep', 'start_speech', 'yield', 'interrupt', 'forfeit', 'leave', 'complete', 'submit_ballot', 'change_judge', 'stop', 'void_source', 'check_in', 'adjudicate'));--> statement-breakpoint
ALTER TABLE "round_judging_jobs" DROP CONSTRAINT "round_judging_jobs_terminal_reason_check", ADD CONSTRAINT "round_judging_jobs_terminal_reason_check" CHECK (("status" = 'failed') = ("terminal_reason" is not null) and ("terminal_reason" is null or "terminal_reason" in ('assignment_retired', 'attempts_exhausted', 'ballot_discarded', 'ballot_hold_ended', 'generation_deadline', 'provider_refused', 'round_ended')));
--> statement-breakpoint
-- Room Start may construct an already-active Round. Only its actual creating transaction
-- may populate that cast; later identities use the ordinary assignment command.
CREATE FUNCTION public.daisy_round_is_being_constructed(target_round_id text) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT coalesce((SELECT r.version=1 AND (
   r.room_id IS NULL AND r.status='opening' OR
   r.status IN ('opening','active') AND r.xmin=pg_current_xact_id()::xid
 ) FROM public.rounds r WHERE r.id=target_round_id),false);
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_round_is_being_constructed(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_round_is_being_constructed(text) TO daisy_web;
--> statement-breakpoint
-- Frozen slot cardinality is the original ordinary execution grammar, never the current head count.
CREATE FUNCTION public.daisy_round_judge_slot_count(rules jsonb) RETURNS integer
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE raw text:=rules#>>'{seats,judges}';
BEGIN
 IF raw IS NULL OR raw !~ '^(0|[1-9][0-9]{0,2})$' THEN
  RAISE EXCEPTION 'Invalid frozen judge slot count' USING ERRCODE='23514',CONSTRAINT='round_judge_slots_frozen_count';
 END IF;
 IF raw::integer>256 THEN
  RAISE EXCEPTION 'Invalid frozen judge slot count' USING ERRCODE='23514',CONSTRAINT='round_judge_slots_frozen_count';
 END IF;
 RETURN raw::integer;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_round_judge_slot_count(jsonb) FROM PUBLIC;
--> statement-breakpoint
-- Only actual pre-existing relationships are observed. No previous command or assignment instant is inferred.
INSERT INTO public.round_judge_slots(round_id,slot)
 SELECT r.id,n FROM public.rounds r CROSS JOIN LATERAL generate_series(0,public.daisy_round_judge_slot_count(r.rules_snapshot)-1) n;
--> statement-breakpoint
INSERT INTO public.round_judge_assignments(round_id,slot,version,participant_id,actor_id,source,recorded_at)
 SELECT p.round_id,p.slot,1,p.id,p.actor_id,'observed',clock_timestamp()
 FROM public.round_participants p WHERE p.seat_kind='judge';
--> statement-breakpoint
UPDATE public.round_judge_slots s SET current_version=1,participant_id=a.participant_id,actor_id=a.actor_id
 FROM public.round_judge_assignments a WHERE a.round_id=s.round_id AND a.slot=s.slot AND a.version=1;
--> statement-breakpoint
INSERT INTO public.round_finalization_judge_assignments(round_id,slot,assignment_version,participant_id)
 SELECT s.round_id,s.slot,s.current_version,s.participant_id FROM public.round_judge_slots s
 JOIN public.round_finalizations f ON f.round_id=s.round_id;
--> statement-breakpoint
REVOKE INSERT,UPDATE,DELETE ON public.round_judge_slots,public.round_judge_assignments,
 public.round_finalization_judge_assignments,public.round_source_voids FROM daisy_web;
--> statement-breakpoint
CREATE FUNCTION public.daisy_round_assignment_history_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM public.rounds WHERE id=OLD.round_id) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Round assignment history is immutable' USING ERRCODE='23514',CONSTRAINT='round_assignment_history_immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER round_judge_assignments_immutable BEFORE UPDATE OR DELETE ON public.round_judge_assignments
 FOR EACH ROW EXECUTE FUNCTION public.daisy_round_assignment_history_immutable();
--> statement-breakpoint
CREATE TRIGGER round_finalization_judge_assignments_immutable BEFORE UPDATE OR DELETE ON public.round_finalization_judge_assignments
 FOR EACH ROW EXECUTE FUNCTION public.daisy_round_assignment_history_immutable();
--> statement-breakpoint
CREATE TRIGGER round_source_voids_immutable BEFORE UPDATE OR DELETE ON public.round_source_voids
 FOR EACH ROW EXECUTE FUNCTION public.daisy_round_assignment_history_immutable();
--> statement-breakpoint
CREATE FUNCTION public.daisy_round_judge_slots_freeze() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  INSERT INTO public.round_judge_slots(round_id,slot)
   SELECT NEW.id,n FROM generate_series(0,public.daisy_round_judge_slot_count(NEW.rules_snapshot)-1) n;
 ELSIF public.daisy_round_judge_slot_count(NEW.rules_snapshot)<>public.daisy_round_judge_slot_count(OLD.rules_snapshot) THEN
  RAISE EXCEPTION 'Judge slot cardinality froze at Start' USING ERRCODE='23514',CONSTRAINT='round_judge_slots_frozen_count';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_round_judge_slots_freeze() FROM PUBLIC,daisy_web;
--> statement-breakpoint
CREATE TRIGGER rounds_freeze_judge_slots AFTER INSERT OR UPDATE OF rules_snapshot ON public.rounds
 FOR EACH ROW EXECUTE FUNCTION public.daisy_round_judge_slots_freeze();
--> statement-breakpoint
CREATE FUNCTION public.daisy_round_participant_identity_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE parent public.rounds%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN
  IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM public.rounds WHERE id=OLD.round_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'A Round participant identity cannot be rewritten' USING ERRCODE='23514',CONSTRAINT='round_participants_identity_immutable';
 END IF;
 SELECT * INTO parent FROM public.rounds WHERE id=NEW.round_id FOR NO KEY UPDATE;
 IF NOT FOUND THEN RETURN NEW; END IF; -- The actual owning FK supplies the refusal.
 IF NEW.seat_kind<>'judge' AND NOT public.daisy_round_is_being_constructed(NEW.round_id) THEN
  RAISE EXCEPTION 'Non-judge cast froze at Start' USING ERRCODE='23514',CONSTRAINT='round_participants_fixed_cast';
 END IF;
 IF NEW.seat_kind='judge' AND NOT EXISTS(SELECT 1 FROM public.round_judge_slots WHERE round_id=NEW.round_id AND slot=NEW.slot) THEN
  RAISE EXCEPTION 'A judge needs an original frozen slot' USING ERRCODE='23514',CONSTRAINT='round_judge_assignment_slot';
 END IF;
 IF NEW.seat_kind='judge' AND EXISTS(SELECT 1 FROM public.round_participants p
   WHERE p.round_id=NEW.round_id AND p.actor_id=NEW.actor_id AND p.seat_kind<>'judge') OR
  NEW.seat_kind<>'judge' AND EXISTS(SELECT 1 FROM public.round_judge_slots s WHERE s.round_id=NEW.round_id AND s.actor_id=NEW.actor_id) THEN
  RAISE EXCEPTION 'One current seat per actor' USING ERRCODE='23514',CONSTRAINT='round_participants_current_actor';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER round_participants_identity_guard BEFORE INSERT OR UPDATE OR DELETE ON public.round_participants
 FOR EACH ROW EXECUTE FUNCTION public.daisy_round_participant_identity_guard();
--> statement-breakpoint
CREATE FUNCTION public.daisy_round_judge_assignment_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE parent public.rounds%ROWTYPE; current_slot public.round_judge_slots%ROWTYPE;
 identity public.round_participants%ROWTYPE; receipt public.round_commands%ROWTYPE;
BEGIN
 SELECT * INTO parent FROM public.rounds WHERE id=NEW.round_id FOR NO KEY UPDATE;
 SELECT * INTO current_slot FROM public.round_judge_slots WHERE round_id=NEW.round_id AND slot=NEW.slot FOR UPDATE;
 IF NOT FOUND OR NEW.version<>coalesce(current_slot.current_version,0)+1 THEN
  RAISE EXCEPTION 'Assignment must extend its actual slot' USING ERRCODE='23514',CONSTRAINT='round_judge_assignment_version';
 END IF;
 IF current_slot.participant_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.ballots WHERE judge_participant_id=current_slot.participant_id) THEN
  RAISE EXCEPTION 'A submitted assignment cannot retire' USING ERRCODE='23514',CONSTRAINT='round_judge_assignment_submitted';
 END IF;
 IF NEW.participant_id IS NOT NULL THEN
  IF EXISTS(SELECT 1 FROM public.round_judge_assignments WHERE participant_id=NEW.participant_id) THEN
   RAISE EXCEPTION 'A retired assignment identity cannot become current again' USING ERRCODE='23514',CONSTRAINT='round_judge_assignment_identity_reused';
  END IF;
  SELECT * INTO identity FROM public.round_participants WHERE id=NEW.participant_id;
  IF NOT FOUND OR identity.round_id<>NEW.round_id OR identity.seat_kind<>'judge' OR identity.slot<>NEW.slot OR identity.actor_id<>NEW.actor_id THEN
   RAISE EXCEPTION 'Assignment needs its actual judge identity' USING ERRCODE='23514',CONSTRAINT='round_judge_assignment_identity';
  END IF;
 END IF;
 IF NEW.source='initial' THEN
  IF NOT public.daisy_round_is_being_constructed(NEW.round_id) OR NEW.version<>1 OR NEW.participant_id IS NULL OR NEW.recorded_at<parent.created_at OR NEW.recorded_at>clock_timestamp() THEN
   RAISE EXCEPTION 'Initial assignment differs from construction' USING ERRCODE='23514',CONSTRAINT='round_judge_assignment_start';
  END IF;
 ELSIF NEW.source='command' THEN
  SELECT * INTO receipt FROM public.round_commands WHERE command_id=NEW.command_id AND round_id=NEW.round_id;
  IF parent.status NOT IN ('opening','active') OR EXISTS(SELECT 1 FROM public.round_source_voids WHERE round_id=NEW.round_id)
   OR NOT coalesce(receipt.type='change_judge' AND receipt.resulting_version=parent.version+1
    AND receipt.result->>'kind'='judge_assignment' AND receipt.result->>'roundId'=NEW.round_id
    AND (receipt.result->>'slot')::integer=NEW.slot AND (receipt.result->>'assignmentVersion')::integer=NEW.version
    AND receipt.result->'participantId'=coalesce(to_jsonb(NEW.participant_id),'null'::jsonb)
    AND receipt.applied_at=NEW.recorded_at,false) THEN
   RAISE EXCEPTION 'Assignment needs a current ordinary command' USING ERRCODE='23514',CONSTRAINT='round_judge_assignment_command';
  END IF;
  IF current_slot.participant_id IS NOT DISTINCT FROM NEW.participant_id THEN
   RAISE EXCEPTION 'Assignment must change its occupant' USING ERRCODE='23514',CONSTRAINT='round_judge_assignment_unchanged';
  END IF;
 ELSE
  RAISE EXCEPTION 'Old assignment history cannot be manufactured' USING ERRCODE='23514',CONSTRAINT='round_judge_assignment_source';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER round_judge_assignment_guard BEFORE INSERT ON public.round_judge_assignments
 FOR EACH ROW EXECUTE FUNCTION public.daisy_round_judge_assignment_guard();
--> statement-breakpoint
CREATE FUNCTION public.daisy_round_judge_slot_pointer() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 UPDATE public.round_judge_slots SET current_version=NEW.version,participant_id=NEW.participant_id,actor_id=NEW.actor_id
 WHERE round_id=NEW.round_id AND slot=NEW.slot;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_round_judge_slot_pointer() FROM PUBLIC,daisy_web;
--> statement-breakpoint
CREATE TRIGGER round_judge_assignment_pointer AFTER INSERT ON public.round_judge_assignments
 FOR EACH ROW EXECUTE FUNCTION public.daisy_round_judge_slot_pointer();
--> statement-breakpoint
CREATE FUNCTION public.daisy_round_initial_judge_assignment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE parent public.rounds%ROWTYPE;
BEGIN
 SELECT * INTO parent FROM public.rounds WHERE id=NEW.round_id FOR NO KEY UPDATE;
 IF NEW.seat_kind='judge' AND public.daisy_round_is_being_constructed(NEW.round_id) AND EXISTS(
  SELECT 1 FROM public.round_judge_slots WHERE round_id=NEW.round_id AND slot=NEW.slot AND current_version IS NULL
 ) THEN
  INSERT INTO public.round_judge_assignments(round_id,slot,version,participant_id,actor_id,source,recorded_at)
  VALUES(NEW.round_id,NEW.slot,1,NEW.id,NEW.actor_id,'initial',clock_timestamp());
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_round_initial_judge_assignment() FROM PUBLIC,daisy_web;
--> statement-breakpoint
CREATE TRIGGER round_participants_initial_judge_assignment AFTER INSERT ON public.round_participants
 FOR EACH ROW EXECUTE FUNCTION public.daisy_round_initial_judge_assignment();
--> statement-breakpoint
CREATE FUNCTION public.daisy_round_judge_identity_assigned() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.round_participants WHERE id=NEW.id) AND NOT EXISTS(
  SELECT 1 FROM public.round_judge_assignments WHERE participant_id=NEW.id AND round_id=NEW.round_id
 ) THEN
  RAISE EXCEPTION 'A new judge identity must be assigned in its transaction' USING ERRCODE='23514',CONSTRAINT='round_judge_identity_assigned';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER round_judge_identity_assigned AFTER INSERT ON public.round_participants
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.seat_kind='judge')
 EXECUTE FUNCTION public.daisy_round_judge_identity_assigned();
--> statement-breakpoint
CREATE FUNCTION public.daisy_round_participant_is_current(target_participant_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.round_participants p WHERE p.id=target_participant_id AND (
  p.seat_kind<>'judge' OR EXISTS(SELECT 1 FROM public.round_judge_slots s WHERE s.round_id=p.round_id AND s.slot=p.slot AND s.participant_id=p.id)
 ));
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_round_participant_is_current(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_round_participant_is_current(text) TO daisy_web,daisy_audience_publisher,daisy_realtime;
--> statement-breakpoint
CREATE FUNCTION public.daisy_round_judge_slot_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE parent public.rounds%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN
  IF NOT EXISTS(SELECT 1 FROM public.rounds WHERE id=OLD.round_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Frozen judge slots cannot be removed' USING ERRCODE='23514',CONSTRAINT='round_judge_slots_frozen_count';
 END IF;
 SELECT * INTO parent FROM public.rounds WHERE id=NEW.round_id FOR NO KEY UPDATE;
 IF TG_OP='INSERT' THEN
  IF NOT public.daisy_round_is_being_constructed(NEW.round_id) OR NEW.slot<0 OR NEW.slot>=public.daisy_round_judge_slot_count(parent.rules_snapshot)
    OR NEW.current_version IS NOT NULL OR NEW.participant_id IS NOT NULL OR NEW.actor_id IS NOT NULL THEN
   RAISE EXCEPTION 'Judge slots belong to original construction' USING ERRCODE='23514',CONSTRAINT='round_judge_slots_frozen_count';
  END IF;
 ELSIF NEW.round_id<>OLD.round_id OR NEW.slot<>OLD.slot OR NEW.current_version IS NULL
   OR NEW.current_version<>coalesce(OLD.current_version,0)+1 OR NOT EXISTS(
    SELECT 1 FROM public.round_judge_assignments a WHERE a.round_id=NEW.round_id AND a.slot=NEW.slot
      AND a.version=NEW.current_version AND a.participant_id IS NOT DISTINCT FROM NEW.participant_id AND a.actor_id IS NOT DISTINCT FROM NEW.actor_id
   ) THEN
  RAISE EXCEPTION 'The pointer must advance to its appended assignment' USING ERRCODE='23514',CONSTRAINT='round_judge_slots_current_assignment';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER round_judge_slot_guard BEFORE INSERT OR UPDATE OR DELETE ON public.round_judge_slots
 FOR EACH ROW EXECUTE FUNCTION public.daisy_round_judge_slot_guard();
--> statement-breakpoint
CREATE FUNCTION public.daisy_append_round_judge_assignment(
 target_round_id text,target_slot integer,expected_round_version integer,expected_assignment_version integer,
 next_participant_id text,target_command_id text
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE parent public.rounds%ROWTYPE; current_slot public.round_judge_slots%ROWTYPE;
 identity public.round_participants%ROWTYPE; receipt public.round_commands%ROWTYPE;
 existing public.round_judge_assignments%ROWTYPE; next_version integer;
BEGIN
 SELECT * INTO parent FROM public.rounds WHERE id=target_round_id FOR NO KEY UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Missing assignment Round' USING ERRCODE='23514',CONSTRAINT='round_judge_assignment_round'; END IF;
 SELECT * INTO receipt FROM public.round_commands WHERE command_id=target_command_id AND round_id=target_round_id;
 IF NOT FOUND OR receipt.type<>'change_judge' THEN
  RAISE EXCEPTION 'Assignment needs its ordinary command' USING ERRCODE='23514',CONSTRAINT='round_judge_assignment_command';
 END IF;
 SELECT * INTO existing FROM public.round_judge_assignments WHERE round_id=target_round_id AND command_id=target_command_id;
 IF FOUND THEN
  IF existing.slot<>target_slot OR existing.participant_id IS DISTINCT FROM next_participant_id THEN
   RAISE EXCEPTION 'Assignment replay changed source' USING ERRCODE='23514',CONSTRAINT='round_judge_assignment_replay';
  END IF;
  RETURN existing.version;
 END IF;
 IF parent.version<>expected_round_version THEN
  RAISE EXCEPTION 'Assignment Round changed' USING ERRCODE='23514',CONSTRAINT='round_judge_assignment_version';
 END IF;
 SELECT * INTO current_slot FROM public.round_judge_slots WHERE round_id=target_round_id AND slot=target_slot FOR UPDATE;
 IF NOT FOUND OR current_slot.current_version IS DISTINCT FROM expected_assignment_version THEN
  RAISE EXCEPTION 'Assignment slot changed' USING ERRCODE='23514',CONSTRAINT='round_judge_assignment_version';
 END IF;
 IF next_participant_id IS NOT NULL THEN
  SELECT * INTO identity FROM public.round_participants WHERE id=next_participant_id AND round_id=target_round_id AND slot=target_slot AND seat_kind='judge';
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing replacement identity' USING ERRCODE='23514',CONSTRAINT='round_judge_assignment_identity'; END IF;
 END IF;
 next_version:=coalesce(current_slot.current_version,0)+1;
 INSERT INTO public.round_judge_assignments(round_id,slot,version,participant_id,actor_id,source,command_id,recorded_at)
 VALUES(target_round_id,target_slot,next_version,next_participant_id,identity.actor_id,'command',target_command_id,receipt.applied_at);
 UPDATE public.rounds SET version=version+1,updated_at=receipt.applied_at WHERE id=target_round_id;
 RETURN next_version;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_append_round_judge_assignment(text,integer,integer,integer,text,text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_append_round_judge_assignment(text,integer,integer,integer,text,text) TO daisy_web;
--> statement-breakpoint
CREATE FUNCTION public.daisy_freeze_round_judge_assignments() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM id FROM public.rounds WHERE id=NEW.round_id FOR NO KEY UPDATE;
 INSERT INTO public.round_finalization_judge_assignments(round_id,slot,assignment_version,participant_id)
 SELECT round_id,slot,current_version,participant_id FROM public.round_judge_slots WHERE round_id=NEW.round_id ORDER BY slot;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_freeze_round_judge_assignments() FROM PUBLIC,daisy_web;
--> statement-breakpoint
CREATE TRIGGER round_finalizations_freeze_judge_assignments AFTER INSERT ON public.round_finalizations
 FOR EACH ROW EXECUTE FUNCTION public.daisy_freeze_round_judge_assignments();
--> statement-breakpoint
CREATE FUNCTION public.daisy_round_finalization_assignment_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.round_judge_slots s WHERE s.round_id=NEW.round_id AND s.slot=NEW.slot
   AND s.current_version IS NOT DISTINCT FROM NEW.assignment_version AND s.participant_id IS NOT DISTINCT FROM NEW.participant_id) THEN
  RAISE EXCEPTION 'Finalization must freeze the actual current assignment' USING ERRCODE='23514',CONSTRAINT='round_finalization_assignment_current';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER round_finalization_assignment_guard BEFORE INSERT ON public.round_finalization_judge_assignments
 FOR EACH ROW EXECUTE FUNCTION public.daisy_round_finalization_assignment_guard();
--> statement-breakpoint
CREATE FUNCTION public.daisy_round_complete_judge_slots() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE target text;
BEGIN
 IF TG_TABLE_NAME='rounds' THEN target:=NEW.id; ELSE target:=NEW.round_id; END IF;
 PERFORM id FROM public.rounds WHERE id=target FOR NO KEY UPDATE;
 IF EXISTS(SELECT 1 FROM public.rounds WHERE id=target AND status='completed') AND EXISTS(
  SELECT 1 FROM public.round_judge_slots WHERE round_id=target AND participant_id IS NULL
 ) THEN
  RAISE EXCEPTION 'An empty frozen judge slot cannot complete' USING ERRCODE='23514',CONSTRAINT='rounds_judge_slots_complete';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER rounds_judge_slots_complete AFTER INSERT OR UPDATE ON public.rounds
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.status='completed') EXECUTE FUNCTION public.daisy_round_complete_judge_slots();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER round_judge_slots_complete AFTER INSERT OR UPDATE ON public.round_judge_slots
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.daisy_round_complete_judge_slots();
--> statement-breakpoint
-- Submit and replacement serialize on the same canonical Round, even for a direct runtime insert.
CREATE FUNCTION public.daisy_ballot_current_assignment() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM id FROM public.rounds WHERE id=NEW.round_id FOR NO KEY UPDATE;
 IF NOT EXISTS(SELECT 1 FROM public.round_judge_slots s WHERE s.round_id=NEW.round_id AND s.participant_id=NEW.judge_participant_id)
  OR EXISTS(SELECT 1 FROM public.round_source_voids WHERE round_id=NEW.round_id) THEN
  RAISE EXCEPTION 'Only the current judge assignment may submit' USING ERRCODE='23514',CONSTRAINT='ballots_current_judge_assignment';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ballots_current_judge_assignment BEFORE INSERT ON public.ballots
 FOR EACH ROW EXECUTE FUNCTION public.daisy_ballot_current_assignment();
--> statement-breakpoint
CREATE FUNCTION public.daisy_finalization_ballot_assignment() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ballots b JOIN public.round_finalization_judge_assignments a
  ON a.round_id=b.round_id AND a.participant_id=b.judge_participant_id
  WHERE b.id=NEW.ballot_id AND a.round_id=NEW.round_id) THEN
  RAISE EXCEPTION 'Consumed ballot must belong to the frozen assignment' USING ERRCODE='23514',CONSTRAINT='round_finalization_ballots_assignment';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER round_finalization_ballots_assignment BEFORE INSERT ON public.round_finalization_ballots
 FOR EACH ROW EXECUTE FUNCTION public.daisy_finalization_ballot_assignment();
--> statement-breakpoint
CREATE FUNCTION public.daisy_round_source_void_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE parent public.rounds%ROWTYPE; receipt public.round_commands%ROWTYPE;
BEGIN
 SELECT * INTO parent FROM public.rounds WHERE id=NEW.round_id FOR NO KEY UPDATE;
 SELECT * INTO receipt FROM public.round_commands WHERE command_id=NEW.command_id AND round_id=NEW.round_id;
 IF parent.status NOT IN ('completed','abandoned') OR NOT coalesce(
  receipt.applied_at=NEW.recorded_at AND receipt.resulting_version=parent.version AND (
   receipt.type='void_source' AND receipt.result->>'kind'='round_source_void' AND receipt.result->>'roundId'=NEW.round_id OR
   receipt.type='stop' AND parent.status='abandoned' AND EXISTS(SELECT 1 FROM public.round_finalizations f
    WHERE f.round_id=NEW.round_id AND f.command_id=NEW.command_id AND f.resulting_version=parent.version)
  ),false) THEN
  RAISE EXCEPTION 'Source void requires its actual terminal ordinary command' USING ERRCODE='23514',CONSTRAINT='round_source_void_command';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER round_source_void_command BEFORE INSERT ON public.round_source_voids
 FOR EACH ROW EXECUTE FUNCTION public.daisy_round_source_void_guard();
--> statement-breakpoint
CREATE FUNCTION public.daisy_mark_round_source_void(target_round_id text,target_command_id text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE existing public.round_source_voids%ROWTYPE; receipt public.round_commands%ROWTYPE;
BEGIN
 PERFORM id FROM public.rounds WHERE id=target_round_id FOR NO KEY UPDATE;
 SELECT * INTO existing FROM public.round_source_voids WHERE round_id=target_round_id;
 IF FOUND THEN
  IF existing.command_id<>target_command_id THEN
   RAISE EXCEPTION 'Source was voided by another command' USING ERRCODE='23514',CONSTRAINT='round_source_void_replay';
  END IF;
  RETURN false;
 END IF;
 SELECT * INTO receipt FROM public.round_commands WHERE command_id=target_command_id AND round_id=target_round_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Missing ordinary source command' USING ERRCODE='23514',CONSTRAINT='round_source_void_command'; END IF;
 INSERT INTO public.round_source_voids(round_id,command_id,recorded_at) VALUES(target_round_id,target_command_id,receipt.applied_at);
 RETURN true;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_mark_round_source_void(text,text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.daisy_mark_round_source_void(text,text) TO daisy_web;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_winnerless_round_completion() RETURNS trigger LANGUAGE plpgsql AS $guard$
DECLARE target_round text;
BEGIN
  IF TG_TABLE_NAME = 'rounds' THEN
    target_round := NEW.id;
  ELSE
    target_round := NEW.round_id;
  END IF;
  PERFORM id FROM rounds WHERE id = target_round FOR NO KEY UPDATE;
  IF EXISTS (
    SELECT 1 FROM rounds r
    WHERE r.id = target_round AND r.status = 'completed' AND r.winning_side IS NULL AND r.ranking IS NULL
      AND EXISTS (
        SELECT 1 FROM round_participants p JOIN actors a ON a.id = p.actor_id
        WHERE p.round_id = r.id AND p.seat_kind = 'judge' AND public.daisy_round_participant_is_current(p.id) AND a.kind = 'human'
          AND NOT EXISTS (SELECT 1 FROM ballots b WHERE b.judge_participant_id = p.id)
      )
      AND (r.ballot_deadline_at IS NULL OR clock_timestamp() < r.ballot_deadline_at)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', CONSTRAINT = 'rounds_winnerless_completion_check', MESSAGE = 'A Round with a human judge completes without a result only once every human judge has ruled or their deadline has passed';
  END IF;
  RETURN NEW;
END;
$guard$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.daisy_round_floor_fact(requested_round_id text, requested_actor_id text)
RETURNS TABLE(version bigint, status text, completed_at timestamp with time zone, audience text, channel_id text, authority_revision bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $round_floor_fact$
 SELECT r.version::bigint,r.status,r.completed_at,
 CASE WHEN p.seat_kind IN ('side','speaker') THEN 'debater' WHEN p.seat_kind IS NOT NULL THEN NULL
 WHEN r.created_by_actor_id=requested_actor_id THEN 'host' ELSE NULL END,
 c.id,c.authority_revision
 FROM public.rounds r LEFT JOIN public.round_participants p ON p.round_id=r.id AND p.actor_id=requested_actor_id AND public.daisy_round_participant_is_current(p.id)
 LEFT JOIN public.messaging_channels c ON c.round_id=r.id AND c.kind='round_floor'
 WHERE r.id=requested_round_id AND (c.id IS NULL OR (c.policy_revision=1 AND c.lifecycle='active'));
$round_floor_fact$;
--> statement-breakpoint
-- Unsubmitted retirement remains possible before the fixture result; terminal witnesses never reselect current occupants.
CREATE OR REPLACE FUNCTION public.daisy_round_judge_assignment_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE parent public.rounds%ROWTYPE; current_slot public.round_judge_slots%ROWTYPE;
 identity public.round_participants%ROWTYPE; receipt public.round_commands%ROWTYPE;
BEGIN
 SELECT * INTO parent FROM public.rounds WHERE id=NEW.round_id FOR NO KEY UPDATE;
 SELECT * INTO current_slot FROM public.round_judge_slots WHERE round_id=NEW.round_id AND slot=NEW.slot FOR UPDATE;
 IF NOT FOUND OR NEW.version<>coalesce(current_slot.current_version,0)+1 THEN
  RAISE EXCEPTION 'Assignment must extend its actual slot' USING ERRCODE='23514',CONSTRAINT='round_judge_assignment_version';
 END IF;
 IF current_slot.participant_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.ballots WHERE judge_participant_id=current_slot.participant_id) THEN
  RAISE EXCEPTION 'A submitted assignment cannot retire' USING ERRCODE='23514',CONSTRAINT='round_judge_assignment_submitted';
 END IF;
 IF NEW.participant_id IS NOT NULL THEN
  IF EXISTS(SELECT 1 FROM public.round_judge_assignments WHERE participant_id=NEW.participant_id) THEN
   RAISE EXCEPTION 'A retired assignment identity cannot become current again' USING ERRCODE='23514',CONSTRAINT='round_judge_assignment_identity_reused';
  END IF;
  SELECT * INTO identity FROM public.round_participants WHERE id=NEW.participant_id;
  IF NOT FOUND OR identity.round_id<>NEW.round_id OR identity.seat_kind<>'judge' OR identity.slot<>NEW.slot OR identity.actor_id<>NEW.actor_id THEN
   RAISE EXCEPTION 'Assignment needs its actual judge identity' USING ERRCODE='23514',CONSTRAINT='round_judge_assignment_identity';
  END IF;
 END IF;
 IF NEW.source='initial' THEN
  IF NOT public.daisy_round_is_being_constructed(NEW.round_id) OR NEW.version<>1 OR NEW.participant_id IS NULL OR NEW.recorded_at<parent.created_at OR NEW.recorded_at>clock_timestamp() THEN
   RAISE EXCEPTION 'Initial assignment differs from construction' USING ERRCODE='23514',CONSTRAINT='round_judge_assignment_start';
  END IF;
 ELSIF NEW.source='command' THEN
  SELECT * INTO receipt FROM public.round_commands WHERE command_id=NEW.command_id AND round_id=NEW.round_id;
  IF parent.status NOT IN ('opening','active','completed','abandoned') OR
   (parent.status IN ('completed','abandoned') AND NOT EXISTS(SELECT 1 FROM public.round_finalizations WHERE round_id=NEW.round_id)) OR
   EXISTS(SELECT 1 FROM public.round_source_voids WHERE round_id=NEW.round_id)
   OR NOT coalesce(receipt.type='change_judge' AND receipt.resulting_version=parent.version+1
    AND receipt.result->>'kind'='judge_assignment' AND receipt.result->>'roundId'=NEW.round_id
    AND (receipt.result->>'slot')::integer=NEW.slot AND (receipt.result->>'assignmentVersion')::integer=NEW.version
    AND receipt.result->'participantId'=coalesce(to_jsonb(NEW.participant_id),'null'::jsonb)
    AND receipt.applied_at=NEW.recorded_at,false) THEN
   RAISE EXCEPTION 'Assignment needs a current ordinary command' USING ERRCODE='23514',CONSTRAINT='round_judge_assignment_command';
  END IF;
  IF current_slot.participant_id IS NOT DISTINCT FROM NEW.participant_id THEN
   RAISE EXCEPTION 'Assignment must change its occupant' USING ERRCODE='23514',CONSTRAINT='round_judge_assignment_unchanged';
  END IF;
 ELSE
  RAISE EXCEPTION 'Old assignment history cannot be manufactured' USING ERRCODE='23514',CONSTRAINT='round_judge_assignment_source';
 END IF;
 RETURN NEW;
END;
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.daisy_round_complete_judge_slots() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE target text; empty_slot boolean;
BEGIN
 IF TG_TABLE_NAME='rounds' THEN target:=NEW.id; ELSE target:=NEW.round_id; END IF;
 PERFORM id FROM public.rounds WHERE id=target FOR NO KEY UPDATE;
 IF EXISTS(SELECT 1 FROM public.rounds WHERE id=target AND status='completed') THEN
  IF EXISTS(SELECT 1 FROM public.round_finalizations WHERE round_id=target) THEN
   -- Finality selected this immutable full panel. Later retirement revokes current
   -- authority, without changing that ending or giving another judge a vote in it.
   SELECT EXISTS(SELECT 1 FROM public.round_finalization_judge_assignments WHERE round_id=target AND participant_id IS NULL)
    OR (SELECT count(*) FROM public.round_finalization_judge_assignments WHERE round_id=target)
       <>(SELECT count(*) FROM public.round_judge_slots WHERE round_id=target) INTO empty_slot;
  ELSE
   SELECT EXISTS(SELECT 1 FROM public.round_judge_slots WHERE round_id=target AND participant_id IS NULL) INTO empty_slot;
  END IF;
  IF empty_slot THEN
   RAISE EXCEPTION 'An empty frozen judge slot cannot complete' USING ERRCODE='23514',CONSTRAINT='rounds_judge_slots_complete';
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
-- Retained decided records gain the actual prefix selected by ordinary finality.
-- The observation source and instant remain observations, never invented old commands or assignment times.
-- The migration owner temporarily suspends only this table's append guard in this transaction;
-- runtime UPDATE/DELETE privileges and every competitive value/digest remain unchanged.
ALTER TABLE public.results DISABLE TRIGGER results_append_only;
--> statement-breakpoint
UPDATE public.results result SET competition_record=jsonb_set(result.competition_record,'{source,judgeAssignments}',(
 SELECT jsonb_agg(jsonb_build_object('slot',frozen.slot,'versions',(
  SELECT jsonb_agg(jsonb_build_object(
   'version',assignment.version,'participantId',assignment.participant_id,'actorId',assignment.actor_id,
   'source',assignment.source,'commandId',assignment.command_id,
   'recordedAt',to_char(assignment.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ) ORDER BY assignment.version)
  FROM public.round_judge_assignments assignment
  WHERE assignment.round_id=frozen.round_id AND assignment.slot=frozen.slot AND assignment.version<=frozen.assignment_version
 )) ORDER BY frozen.slot)
 FROM public.round_finalization_judge_assignments frozen WHERE frozen.round_id=result.round_id
)) WHERE result.kind='decided';
--> statement-breakpoint
SET CONSTRAINTS ALL IMMEDIATE;
--> statement-breakpoint
ALTER TABLE public.results ENABLE TRIGGER results_append_only;
--> statement-breakpoint
ALTER TABLE "action_history" ADD COLUMN "confirmed_by_user_id" text;--> statement-breakpoint
CREATE INDEX "action_history_confirmed_by_idx" ON "action_history" ("confirmed_by_user_id");--> statement-breakpoint
ALTER TABLE "action_history" ADD CONSTRAINT "action_history_confirmed_by_user_id_users_id_fkey" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "action_history" ADD CONSTRAINT "action_history_second_person_check" CHECK ("confirmed_by_user_id" is null or ("actor_user_id" is not null and "confirmed_by_user_id"<>"actor_user_id" and "conflict_id" is not null));
--> statement-breakpoint
-- Terminal competitive state is absorbing. A release based on it cannot be reopened.
CREATE FUNCTION public.daisy_round_terminal_status() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF OLD.status IN ('completed','abandoned') AND NEW.status IS DISTINCT FROM OLD.status THEN
  RAISE EXCEPTION 'A terminal Round cannot reopen or change its ending kind'
   USING ERRCODE='23514',CONSTRAINT='rounds_terminal_status';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_round_terminal_status() FROM PUBLIC,daisy_web;
--> statement-breakpoint
CREATE TRIGGER rounds_terminal_status BEFORE UPDATE OF status ON public.rounds
 FOR EACH ROW EXECUTE FUNCTION public.daisy_round_terminal_status();
--> statement-breakpoint
-- Every Recording over an admitted Round, including a direct INSERT, takes the
-- same admission fence. An alternative eligibility kind cannot evade settlement.
CREATE OR REPLACE FUNCTION public.daisy_recording_admission_deadline() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE admission public.tournament_capture_admissions%ROWTYPE;
BEGIN
 SELECT * INTO admission FROM public.tournament_capture_admissions WHERE round_id=NEW.round_id FOR UPDATE;
 IF FOUND THEN
  IF admission.settled_at IS NOT NULL OR NOT coalesce(
   NEW.eligibility->>'kind'='tournament_admission'
   AND NEW.eligibility->>'admissionId'=admission.id
   AND jsonb_typeof(NEW.eligibility->'deadlineAt')='string'
   AND isfinite((NEW.eligibility->>'deadlineAt')::timestamptz)
   AND (NEW.eligibility->>'deadlineAt')::timestamptz=admission.deadline_at,false)
  THEN
   RAISE EXCEPTION 'Recording must name its actual open admission'
    USING ERRCODE='23514',CONSTRAINT='recordings_admission_deadline';
  END IF;
 ELSIF NEW.eligibility->>'kind'='tournament_admission' THEN
  RAISE EXCEPTION 'Recording admission does not exist'
   USING ERRCODE='23514',CONSTRAINT='recordings_admission_deadline';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.daisy_recording_settle_undispatched_tournament_admission(target_round_id text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE admission public.tournament_capture_admissions%ROWTYPE;
BEGIN
 SELECT * INTO admission FROM public.tournament_capture_admissions WHERE round_id=target_round_id FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF admission.settled_at IS NOT NULL THEN RETURN true; END IF;
 -- No child resource exists, the Round is irreversibly terminal, and the
 -- admission fence prevents any later request or dispatch from using it.
 IF EXISTS(SELECT 1 FROM public.rounds WHERE id=target_round_id AND status IN ('completed','abandoned'))
  AND NOT EXISTS(SELECT 1 FROM public.recordings WHERE round_id=target_round_id)
  AND NOT EXISTS(SELECT 1 FROM public.recording_captures WHERE round_id=target_round_id)
  AND NOT EXISTS(SELECT 1 FROM public.broadcasts WHERE round_id=target_round_id)
 THEN
  UPDATE public.tournament_capture_admissions SET settled_at=clock_timestamp() WHERE id=admission.id;
  RETURN true;
 END IF;
 -- Existing deadline cleanup remains separate from terminal zero-work release.
 IF clock_timestamp()<admission.deadline_at OR EXISTS(
  SELECT 1 FROM public.recording_captures c WHERE c.round_id=target_round_id
   AND (c.egress_dispatched_at IS NOT NULL OR c.egress_id IS NOT NULL)
 ) THEN RETURN false; END IF;
 UPDATE public.tournament_capture_admissions SET settled_at=clock_timestamp() WHERE id=admission.id;
 RETURN true;
END;
$$;

--> statement-breakpoint
ALTER TABLE "ballot_screenings" ADD COLUMN "rule_set_version" text NOT NULL;--> statement-breakpoint
ALTER TABLE "ballot_screenings" ADD CONSTRAINT "ballot_screenings_rule_set_version_nonempty" CHECK (length("rule_set_version") > 0);