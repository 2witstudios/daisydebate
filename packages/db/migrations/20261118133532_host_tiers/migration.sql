CREATE TABLE "tournament_hosting_purchases" (
	"id" text PRIMARY KEY,
	"lobby_id" text NOT NULL,
	"payer_user_id" text NOT NULL,
	"tier" text NOT NULL,
	"amount" integer NOT NULL,
	"mode" text NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"vendor_session_id" text,
	"vendor_payment_intent_id" text,
	"receipt_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	CONSTRAINT "tournament_hosting_purchases_tier_check" CHECK ("tier" in ('event_64', 'event_unlimited')),
	CONSTRAINT "tournament_hosting_purchases_state_check" CHECK ("state" in ('open', 'paid', 'expired')),
	CONSTRAINT "tournament_hosting_purchases_mode_check" CHECK ("mode" in ('test', 'live')),
	CONSTRAINT "tournament_hosting_purchases_amount_check" CHECK ("amount" > 0 and "amount" <= 19900),
	CONSTRAINT "tournament_hosting_purchases_identity_check" CHECK ("id" ~ '^[a-z0-9]{24}$'
    and ("vendor_session_id" is null or ("vendor_session_id" ~ '^cs_(test|live)_[A-Za-z0-9]+$' and length("vendor_session_id") <= 255))
    and ("vendor_payment_intent_id" is null or ("vendor_payment_intent_id" ~ '^pi_[A-Za-z0-9]+$' and length("vendor_payment_intent_id") <= 255))
    and ("receipt_url" is null or ("receipt_url" ~ '^https://pay[.]stripe[.]com/receipts/' and length("receipt_url") <= 2048))),
	CONSTRAINT "tournament_hosting_purchases_lifecycle_check" CHECK (case "state"
    when 'open' then "paid_at" is null and "expired_at" is null
    when 'paid' then "paid_at" is not null and "expired_at" is null and "vendor_session_id" is not null and "vendor_payment_intent_id" is not null
    when 'expired' then "paid_at" is null and "expired_at" is not null
    else false end)
);
--> statement-breakpoint
ALTER TABLE "tournament_capture_admissions" ADD COLUMN "hosting_purchase_id" text;--> statement-breakpoint
ALTER TABLE "tournament_capture_admissions" ALTER COLUMN "hosting_version_id" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "tournament_capture_admissions_hosting_purchase_idx" ON "tournament_capture_admissions" ("hosting_purchase_id");--> statement-breakpoint
CREATE INDEX "tournament_hosting_purchases_lobby_idx" ON "tournament_hosting_purchases" ("lobby_id","created_at");--> statement-breakpoint
CREATE INDEX "tournament_hosting_purchases_payer_idx" ON "tournament_hosting_purchases" ("payer_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_hosting_purchases_open_unique" ON "tournament_hosting_purchases" ("lobby_id") WHERE "state" = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_hosting_purchases_session_unique" ON "tournament_hosting_purchases" ("mode","vendor_session_id");--> statement-breakpoint
ALTER TABLE "tournament_capture_admissions" ADD CONSTRAINT "tournament_capture_admissions_uKq39gHHhMCE_fkey" FOREIGN KEY ("hosting_purchase_id") REFERENCES "tournament_hosting_purchases"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "tournament_hosting_purchases" ADD CONSTRAINT "tournament_hosting_purchases_lobby_id_tournaments_lobby_id_fkey" FOREIGN KEY ("lobby_id") REFERENCES "tournaments"("lobby_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "tournament_hosting_purchases" ADD CONSTRAINT "tournament_hosting_purchases_payer_user_id_users_id_fkey" FOREIGN KEY ("payer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "tournament_capture_admissions" ADD CONSTRAINT "tournament_capture_admissions_one_basis" CHECK (("hosting_version_id" is null) <> ("hosting_purchase_id" is null));--> statement-breakpoint
ALTER TABLE "settings" DROP CONSTRAINT "settings_key_check", ADD CONSTRAINT "settings_key_check" CHECK ("key" in ('pairing.preset', 'pairing.method', 'pairing.section_size', 'pairing.rematch', 'pairing.same_school', 'pairing.side_balance', 'pairing.side_alternation', 'pairing.pull_up', 'pairing.position_balance', 'pairing.section_repeat', 'pairing.preference_order', 'bye.recipient', 'bye.result', 'bye.repeat', 'judging.panel', 'judging.availability', 'judging.strike', 'judging.conflict', 'judging.same_school', 'judging.repeat_judge', 'judging.unsubmitted_ballot', 'judging.load_balance', 'judging.chair', 'judging.panel_same_school', 'judging.preference_order', 'standings.tiebreaks', 'standings.rating_ladder', 'break.line', 'break.seeding', 'break.double_qualifier', 'entry.divisions', 'entry.registration', 'entry.approval', 'entry.cap', 'entry.judge_obligation', 'conflict.handling', 'recording.capture', 'judging.ai_judge', 'broadcast.live', 'audience.posting', 'audience.decision', 'audience.scores', 'audience.reason', 'audience.feedback', 'audience.video', 'ballot.screening', 'resolution.rule', 'resolution.own_text', 'room.own_format', 'room.visibility', 'room.timing', 'room.floor', 'staff.minimum_band'));--> statement-breakpoint
ALTER TABLE "tournament_capture_admissions" DROP CONSTRAINT "tournament_capture_admissions_identity";--> statement-breakpoint
-- ADR 0147: an admission names its funding basis; existing ones were all grants.
ALTER TABLE "tournament_capture_admissions" DISABLE TRIGGER "tournament_capture_admissions_immutable";--> statement-breakpoint
UPDATE "tournament_capture_admissions" SET "admission" = ("admission" - 'grant') || jsonb_build_object('basis', jsonb_build_object('kind', 'grant', 'grant', "admission"->'grant')) WHERE "admission" ? 'grant';--> statement-breakpoint
-- Fire any constraint trigger the rewrite queued before more DDL on the table.
SET CONSTRAINTS ALL IMMEDIATE;--> statement-breakpoint
ALTER TABLE "tournament_capture_admissions" ENABLE TRIGGER "tournament_capture_admissions_immutable";--> statement-breakpoint
ALTER TABLE "tournament_capture_admissions" ADD CONSTRAINT "tournament_capture_admissions_identity" CHECK (coalesce("admission"->>'id'="id" and "admission"->>'roundId'="round_id" and "admission"->>'roomId'="room_id" and "admission"->>'lobbyId'="lobby_id" and "admission"->>'fixtureId'="fixture_id" and "admission"->>'commandId'="command_id" and case "admission"->'basis'->>'kind' when 'grant' then "admission"->'basis'->'grant'->'hosting'->>'id'="hosting_version_id" and "admission"->'basis'->'grant'->'hosting'->>'userId'="sponsor_user_id" when 'hosting-purchase' then "admission"->'basis'->'purchase'->>'id'="hosting_purchase_id" and "admission"->'basis'->'purchase'->>'lobbyId'="lobby_id" else false end and "admission"->'official'->>'userId'="official_user_id" and "admission"->'official'->>'actorId'="official_actor_id" and ("admission"->>'admittedAt')::timestamptz="created_at" and ("admission"->>'deadlineAt')::timestamptz="deadline_at" and case "admission"->'funding'->>'kind' when 'personal-owner' then "sponsorship_version_id" is null and "admission"->'funding'->>'ownerUserId'="sponsor_user_id" when 'organization-sponsor' then "sponsorship_version_id" is not null and "admission"->'funding'->>'sponsorshipVersionId'="sponsorship_version_id" else false end,false));
--> statement-breakpoint
ALTER TABLE "tournament_hosting_purchases" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tournament_hosting_purchases_scope" ON "tournament_hosting_purchases" FOR ALL USING (lobby_id = daisy_lobby_scope()) WITH CHECK (lobby_id = daisy_lobby_scope());
--> statement-breakpoint
REVOKE DELETE ON tournament_hosting_purchases FROM daisy_web;
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
