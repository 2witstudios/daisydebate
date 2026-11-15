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
