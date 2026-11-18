ALTER TABLE "tournament_capture_admissions" ADD COLUMN "hosting_purchase_id" text;--> statement-breakpoint
ALTER TABLE "tournament_capture_admissions" ALTER COLUMN "hosting_version_id" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "tournament_capture_admissions_hosting_purchase_idx" ON "tournament_capture_admissions" ("hosting_purchase_id");--> statement-breakpoint
ALTER TABLE "tournament_capture_admissions" ADD CONSTRAINT "tournament_capture_admissions_uKq39gHHhMCE_fkey" FOREIGN KEY ("hosting_purchase_id") REFERENCES "tournament_hosting_purchases"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "tournament_capture_admissions" ADD CONSTRAINT "tournament_capture_admissions_one_basis" CHECK (("hosting_version_id" is null) <> ("hosting_purchase_id" is null));--> statement-breakpoint
ALTER TABLE "tournament_capture_admissions" DROP CONSTRAINT "tournament_capture_admissions_identity";--> statement-breakpoint
-- ADR 0147: an admission names its funding basis; existing ones were all grants.
ALTER TABLE "tournament_capture_admissions" DISABLE TRIGGER "tournament_capture_admissions_immutable";--> statement-breakpoint
UPDATE "tournament_capture_admissions" SET "admission" = ("admission" - 'grant') || jsonb_build_object('basis', jsonb_build_object('kind', 'grant', 'grant', "admission"->'grant')) WHERE "admission" ? 'grant';--> statement-breakpoint
-- Fire any constraint trigger the rewrite queued before more DDL on the table.
SET CONSTRAINTS ALL IMMEDIATE;--> statement-breakpoint
ALTER TABLE "tournament_capture_admissions" ENABLE TRIGGER "tournament_capture_admissions_immutable";--> statement-breakpoint
ALTER TABLE "tournament_capture_admissions" ADD CONSTRAINT "tournament_capture_admissions_identity" CHECK (coalesce("admission"->>'id'="id" and "admission"->>'roundId'="round_id" and "admission"->>'roomId'="room_id" and "admission"->>'lobbyId'="lobby_id" and "admission"->>'fixtureId'="fixture_id" and "admission"->>'commandId'="command_id" and case "admission"->'basis'->>'kind' when 'grant' then "admission"->'basis'->'grant'->'hosting'->>'id'="hosting_version_id" and "admission"->'basis'->'grant'->'hosting'->>'userId'="sponsor_user_id" when 'hosting-purchase' then "admission"->'basis'->'purchase'->>'id'="hosting_purchase_id" and "admission"->'basis'->'purchase'->>'lobbyId'="lobby_id" else false end and "admission"->'official'->>'userId'="official_user_id" and "admission"->'official'->>'actorId'="official_actor_id" and ("admission"->>'admittedAt')::timestamptz="created_at" and ("admission"->>'deadlineAt')::timestamptz="deadline_at" and case "admission"->'funding'->>'kind' when 'personal-owner' then "sponsorship_version_id" is null and "admission"->'funding'->>'ownerUserId'="sponsor_user_id" when 'organization-sponsor' then "sponsorship_version_id" is not null and "admission"->'funding'->>'sponsorshipVersionId'="sponsorship_version_id" else false end,false));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.daisy_tournament_capture_source() RETURNS trigger LANGUAGE plpgsql AS $$
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
 ) OR NOT (
  (NEW.hosting_version_id IS NOT NULL AND EXISTS (
   SELECT 1 FROM public.account_hosting_versions v JOIN public.account_entitlement_grants g
    ON g.hosting_version_id=v.id AND g.user_id=v.user_id AND g.source=v.source
   WHERE v.id=NEW.hosting_version_id AND v.user_id=NEW.sponsor_user_id AND g.revoked_at IS NULL
    AND g.entitlement='tournament_hosting' AND v.starts_at<=NEW.created_at AND NEW.created_at<v.expires_at
    AND NEW.deadline_at<=v.expires_at AND v.coverage->'tournamentIds' ? NEW.lobby_id
    AND NEW.admission->'basis'->'grant'->'hosting'->'coverage'=v.coverage AND NEW.admission->'basis'->'grant'->>'source'=v.source
  ))
  OR (NEW.hosting_purchase_id IS NOT NULL AND NEW.sponsorship_version_id IS NULL AND EXISTS (
   SELECT 1 FROM public.tournament_hosting_purchases p
   WHERE p.id=NEW.hosting_purchase_id AND p.lobby_id=NEW.lobby_id AND p.state='paid'
    AND p.paid_at<=NEW.created_at AND p.tier=NEW.admission->'basis'->'purchase'->>'tier'
  ))
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
