CREATE TABLE "club_seat_invitations" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"invited_by_user_id" text,
	"token_digest" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "club_seat_invitations_email_normalized" CHECK ("email" = lower(btrim("email")) and length("email") between 3 and 320),
	CONSTRAINT "club_seat_invitations_token_check" CHECK ("token_digest" is null or "token_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "club_seat_invitations_expiry_check" CHECK (isfinite("expires_at") and "expires_at" > "created_at")
);
--> statement-breakpoint
CREATE TABLE "club_seats" (
	"organization_id" text,
	"user_id" text,
	"assigned_at" timestamp with time zone NOT NULL,
	CONSTRAINT "club_seats_pkey" PRIMARY KEY("organization_id","user_id"),
	CONSTRAINT "club_seats_assigned_finite" CHECK (isfinite("assigned_at"))
);
--> statement-breakpoint
ALTER TABLE "billing_customers" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "billing_purchases" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "billing_purchases" ADD COLUMN "quantity" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD COLUMN "seat_count" integer;--> statement-breakpoint
ALTER TABLE "account_entitlement_grants" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "mail_intents" ADD COLUMN "club_seat_invitation_id" text;--> statement-breakpoint
ALTER TABLE "billing_customers" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_purchases" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_customers_organization_unique" ON "billing_customers" ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_purchases_pending_organization_unique" ON "billing_purchases" ("organization_id") WHERE "state"->>'kind' in ('admitted','creating','unknown','open');--> statement-breakpoint
CREATE INDEX "billing_purchases_organization_idx" ON "billing_purchases" ("organization_id","admitted_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_subscriptions_current_organization_unique" ON "billing_subscriptions" ("organization_id") WHERE "current";--> statement-breakpoint
CREATE INDEX "billing_subscriptions_organization_idx" ON "billing_subscriptions" ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "club_seat_invitations_token_unique" ON "club_seat_invitations" ("token_digest");--> statement-breakpoint
CREATE INDEX "club_seat_invitations_organization_idx" ON "club_seat_invitations" ("organization_id","expires_at");--> statement-breakpoint
CREATE INDEX "club_seat_invitations_email_idx" ON "club_seat_invitations" ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "club_seats_user_unique" ON "club_seats" ("user_id");--> statement-breakpoint
CREATE INDEX "account_entitlement_grants_organization_idx" ON "account_entitlement_grants" ("organization_id");--> statement-breakpoint
CREATE INDEX "mail_intents_club_invitation_idx" ON "mail_intents" ("club_seat_invitation_id");--> statement-breakpoint
ALTER TABLE "billing_customers" ADD CONSTRAINT "billing_customers_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "billing_purchases" ADD CONSTRAINT "billing_purchases_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "club_seat_invitations" ADD CONSTRAINT "club_seat_invitations_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "club_seat_invitations" ADD CONSTRAINT "club_seat_invitations_invited_by_user_id_users_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "club_seats" ADD CONSTRAINT "club_seats_organization_id_organizations_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "club_seats" ADD CONSTRAINT "club_seats_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "account_entitlement_grants" ADD CONSTRAINT "account_entitlement_grants_4ZHxaJ15Cfxe_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "mail_intents" ADD CONSTRAINT "mail_intents_Q0wgWYmMrH8W_fkey" FOREIGN KEY ("club_seat_invitation_id") REFERENCES "club_seat_invitations"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "billing_customers" ADD CONSTRAINT "billing_customers_one_owner" CHECK (num_nonnulls("user_id", "organization_id") = 1);--> statement-breakpoint
ALTER TABLE "billing_purchases" ADD CONSTRAINT "billing_purchases_one_owner" CHECK (num_nonnulls("user_id", "organization_id") = 1);--> statement-breakpoint
ALTER TABLE "billing_purchases" ADD CONSTRAINT "billing_purchases_quantity_check" CHECK (("organization_id" is null and "quantity" = 1) or ("organization_id" is not null and "quantity" between 1 and 200));--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_one_owner" CHECK (num_nonnulls("user_id", "organization_id") = 1);--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_seat_count_check" CHECK ("seat_count" is null or ("organization_id" is not null and "seat_count" between 1 and 200));--> statement-breakpoint
ALTER TABLE "account_entitlement_grants" ADD CONSTRAINT "account_entitlement_grants_seat_organization_check" CHECK (("source" = 'organization_seat') = ("organization_id" is not null));--> statement-breakpoint
ALTER TABLE "mail_intents" ADD CONSTRAINT "mail_intents_club_invitation_check" CHECK (("purpose" = 'club-seat-invitation' and ("club_seat_invitation_id" is not null or "state" in ('sent', 'failed', 'cancelled'))) or ("purpose" <> 'club-seat-invitation' and "club_seat_invitation_id" is null));--> statement-breakpoint
ALTER TABLE "account_entitlement_grants" DROP CONSTRAINT "account_entitlement_grants_validity_check", ADD CONSTRAINT "account_entitlement_grants_validity_check" CHECK (
      ("entitlement" = 'tournament_hosting' and "source" in ('administrative', 'subscription') and "hosting_version_id" is not null and "starts_at" is null and "expires_at" is null)
      or ("entitlement" <> 'tournament_hosting' and "hosting_version_id" is null and (( "source" = 'beta' and "starts_at" is null and "expires_at" is null)
      or ("source" in ('subscription', 'organization_seat') and "starts_at" is not null and "expires_at" is not null
        and isfinite("starts_at") and isfinite("expires_at") and "starts_at" < "expires_at")))
    );--> statement-breakpoint
ALTER TABLE "account_entitlement_grants" DROP CONSTRAINT "account_entitlement_grants_source_check", ADD CONSTRAINT "account_entitlement_grants_source_check" CHECK ("source" in ('beta', 'subscription', 'administrative', 'organization_seat'));--> statement-breakpoint
ALTER TABLE "mail_intents" DROP CONSTRAINT "mail_intents_purpose_check", ADD CONSTRAINT "mail_intents_purpose_check" CHECK ("purpose" in ('beta-invitation', 'beta-approved', 'beta-requests-digest', 'club-seat-invitation'));--> statement-breakpoint
ALTER TABLE "organizations" DROP CONSTRAINT "organizations_kind_check", ADD CONSTRAINT "organizations_kind_check" CHECK ("kind" in ('league', 'school', 'family'));--> statement-breakpoint
ALTER TABLE "usage_reservations" DROP CONSTRAINT "usage_reservations_source_check", ADD CONSTRAINT "usage_reservations_source_check" CHECK (coalesce(case "source"->>'kind'
      when 'lifetime' then "source"='{"kind":"lifetime"}'::jsonb
      when 'beta' then "source"-array['kind','startsAt','endsAt']='{}'::jsonb
      when 'subscription' then "source"-array['kind','subscriptionId','startsAt','endsAt']='{}'::jsonb
        and "source"->>'subscriptionId' ~ '^[a-z][a-z0-9]{23}$'
      when 'organization_seat' then "source"-array['kind','organizationId','startsAt','endsAt']='{}'::jsonb
        and "source"->>'organizationId' ~ '^[a-z0-9]{24}$'
      else false end, false) and coalesce(
        "source"->>'kind'='lifetime' or (
          jsonb_typeof("source"->'startsAt')='string' and jsonb_typeof("source"->'endsAt')='string'
          and isfinite(("source"->>'startsAt')::timestamptz) and isfinite(("source"->>'endsAt')::timestamptz)
          and ("source"->>'startsAt')::timestamptz < ("source"->>'endsAt')::timestamptz), false));--> statement-breakpoint
ALTER TABLE "club_seats" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "club_seats_scope" ON "club_seats" FOR ALL USING (organization_id = daisy_organization_scope()) WITH CHECK (organization_id = daisy_organization_scope());
--> statement-breakpoint
CREATE POLICY "club_seats_subject" ON "club_seats" FOR SELECT USING (user_id = daisy_subject_scope());
--> statement-breakpoint
ALTER TABLE "club_seat_invitations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "club_seat_invitations_scope" ON "club_seat_invitations" FOR ALL USING (organization_id = daisy_organization_scope()) WITH CHECK (organization_id = daisy_organization_scope());
--> statement-breakpoint
-- ADR 0148: the billing owner is immutable on every billing row, beside the
-- identity each guard already froze; a purchase's seat quantity is frozen at
-- admission so a retried Checkout sends identical parameters.
CREATE OR REPLACE FUNCTION public.daisy_guard_billing_customer() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $billing_customer$
BEGIN
  IF (NEW.id, NEW.user_id, NEW.organization_id, NEW.vendor_customer_id, NEW.mode, NEW.created_at)
    IS DISTINCT FROM (OLD.id, OLD.user_id, OLD.organization_id, OLD.vendor_customer_id, OLD.mode, OLD.created_at)
    OR (OLD.closed_at IS NOT NULL AND NEW.closed_at IS DISTINCT FROM OLD.closed_at)
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Billing customer identity is immutable';
  END IF;
  RETURN NEW;
END;
$billing_customer$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.daisy_guard_billing_subscription() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $billing_subscription$
BEGIN
  IF (NEW.id, NEW.user_id, NEW.organization_id, NEW.vendor_subscription_id, NEW.created_at)
    IS DISTINCT FROM (OLD.id, OLD.user_id, OLD.organization_id, OLD.vendor_subscription_id, OLD.created_at)
    OR (OLD.evidence->>'lifecycle' IN ('canceled','incomplete_expired')
      AND NEW.evidence->>'lifecycle' IS DISTINCT FROM OLD.evidence->>'lifecycle')
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Billing subscription identity and terminal status are immutable';
  END IF;
  RETURN NEW;
END;
$billing_subscription$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.daisy_guard_billing_purchase() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $billing_purchase$
DECLARE checked timestamptz := clock_timestamp();
BEGIN
  IF NEW.admitted_at > checked
    OR (NEW.state->>'startedAt')::timestamptz > checked
    OR (NEW.state->>'abandonedAt')::timestamptz > checked
    OR (NEW.state->'claim'->>'claimedAt')::timestamptz > checked
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Purchase evidence cannot be in the future';
  END IF;
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  IF (NEW.id, NEW.user_id, NEW.organization_id, NEW.quantity, NEW.mode, NEW.price_id, NEW.vendor_customer_id, NEW.return_origin, NEW.admitted_at)
    IS DISTINCT FROM (OLD.id, OLD.user_id, OLD.organization_id, OLD.quantity, OLD.mode, OLD.price_id, OLD.vendor_customer_id, OLD.return_origin, OLD.admitted_at)
    OR (OLD.state ? 'startedAt' AND NEW.state->>'startedAt' IS DISTINCT FROM OLD.state->>'startedAt')
    OR (OLD.state ? 'sessionId' AND NEW.state->>'sessionId' IS DISTINCT FROM OLD.state->>'sessionId')
    OR (OLD.state->>'customerId' IS NOT NULL AND NEW.state->>'customerId' IS DISTINCT FROM OLD.state->>'customerId')
    OR (OLD.state ? 'subscriptionId' AND NEW.state->>'subscriptionId' IS DISTINCT FROM OLD.state->>'subscriptionId')
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Purchase admission and observed identity are immutable';
  END IF;
  IF (OLD.state->>'kind' IN ('complete','expired','abandoned') AND NEW.state IS DISTINCT FROM OLD.state)
    OR (OLD.state->>'kind'='admitted' AND NEW.state->>'kind' NOT IN ('admitted','creating','abandoned'))
    OR (OLD.state->>'kind' IN ('creating','unknown') AND NEW.state->>'kind' NOT IN ('creating','unknown','open','complete','expired'))
    OR (OLD.state->>'kind'='open' AND NEW.state->>'kind' NOT IN ('open','complete','expired'))
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Purchase evidence cannot be discarded or reopened';
  END IF;
  IF NEW.state->>'kind'='creating' AND NEW.state->'claim' IS DISTINCT FROM OLD.state->'claim' THEN
    IF (NEW.state->'claim'->>'expiresAt')::timestamptz <= checked
      OR NEW.state->'claim'->>'id' = OLD.state->'claim'->>'id'
    THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Purchase creation requires a fresh live claim';
    END IF;
  END IF;
  RETURN NEW;
END;
$billing_purchase$;
