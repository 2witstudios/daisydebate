CREATE TABLE "billing_subscriptions" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"vendor_subscription_id" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"current" boolean NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_subscriptions_evidence_is_object" CHECK (jsonb_typeof("evidence") = 'object'),
	CONSTRAINT "billing_subscriptions_period_identity_check" CHECK (coalesce(
    "evidence"->'settlement'->>'kind'='unpaid' or
    ("evidence"->'settlement'->'period'->>'subscriptionId'="id"
      and ("evidence"->'settlement'->>'kind'<>'renewal_failed' or
        "evidence"->'settlement'->'previous'->'period'->>'subscriptionId'="id")), false))
);
--> statement-breakpoint
ALTER TABLE "usage_reservations" DROP CONSTRAINT "usage_reservations_refund_check";--> statement-breakpoint
ALTER TABLE "usage_reservations" DROP CONSTRAINT "usage_reservations_admission_check";--> statement-breakpoint
DROP INDEX "usage_reservations_actor_period_idx";--> statement-breakpoint
DROP INDEX "usage_reservations_counted_idx";--> statement-breakpoint
ALTER TABLE "account_entitlement_grants" ADD COLUMN "starts_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "account_entitlement_grants" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD COLUMN "source" jsonb;--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD COLUMN "state" jsonb;--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD COLUMN "binds_free_judge" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD COLUMN "binding_released_at" timestamp with time zone;--> statement-breakpoint
-- The predecessor admits only beta AI Rounds. Preserve the actual UTC month
-- of each reservation, including historical counted/refunded periods.
WITH original AS (
  SELECT u.id,
    jsonb_build_object('kind','beta',
      'startsAt',to_char(date_trunc('month',u.reserved_at AT TIME ZONE 'UTC'),'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'endsAt',to_char(date_trunc('month',u.reserved_at AT TIME ZONE 'UTC')+interval '1 month','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) AS source,
    CASE
      WHEN u.counted_at IS NULL THEN CASE WHEN r.status IN ('completed','abandoned')
        THEN jsonb_build_object('kind','released','releasedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
        ELSE jsonb_build_object('kind','reserved') END
      WHEN u.refunded_at IS NOT NULL AND r.platform_ending='recovery_bound' AND incident.id IS NOT NULL
        THEN jsonb_build_object('kind','credited','countedAt',to_char(u.counted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'creditedAt',to_char(u.refunded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'provenance',jsonb_build_object('kind','recovery_bound','incidentId',incident.id),
          'providerOutcome',outcome.value)
      WHEN u.refunded_at IS NOT NULL AND r.platform_ending='capture_shortfall' AND final.command_id IS NOT NULL AND final.freeze_revision IS NOT NULL
        THEN jsonb_build_object('kind','credited','countedAt',to_char(u.counted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'creditedAt',to_char(u.refunded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'provenance',jsonb_build_object('kind','capture_shortfall','commandId',final.command_id,'freezeRevision',final.freeze_revision),
          'providerOutcome',outcome.value)
      WHEN u.refunded_at IS NOT NULL THEN jsonb_build_object('kind','refunded',
        'countedAt',to_char(u.counted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'refundedAt',to_char(u.refunded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
      ELSE jsonb_build_object('kind',CASE WHEN outcome.value='delivered' THEN 'delivered' ELSE 'unknown' END,
        'countedAt',to_char(u.counted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
    END AS state
  FROM usage_reservations u JOIN rounds r ON r.id=u.round_id
  LEFT JOIN LATERAL (SELECT id FROM round_incidents i WHERE i.round_id=u.round_id AND i.ended_at IS NOT NULL
    AND i.resumed_at IS NULL ORDER BY i.ended_at DESC LIMIT 1) incident ON true
  LEFT JOIN round_finalizations final ON final.round_id=u.round_id
  CROSS JOIN LATERAL (
    SELECT CASE WHEN count(*)=0 OR count(*) FILTER(WHERE a.configuration_snapshot->>'providerOutcome' IN ('received','failed'))<>count(*) THEN 'unknown'
      WHEN count(*) FILTER(WHERE a.configuration_snapshot->>'providerOutcome'='received')>0 THEN 'delivered'
      ELSE 'definite_failure' END AS value
    FROM agent_runs a JOIN round_participants p ON p.id=a.round_participant_id
    WHERE p.round_id=u.round_id AND p.role IN ('affirmative','negative') AND a.requests>0
  ) outcome
)
UPDATE usage_reservations u SET source=original.source,state=original.state FROM original WHERE u.id=original.id;
--> statement-breakpoint
SET CONSTRAINTS ALL IMMEDIATE;
--> statement-breakpoint
ALTER TABLE usage_reservations ALTER COLUMN source SET NOT NULL, ALTER COLUMN state SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "usage_reservations" DROP COLUMN "counted_at";--> statement-breakpoint
ALTER TABLE "usage_reservations" DROP COLUMN "refunded_at";--> statement-breakpoint
CREATE UNIQUE INDEX "billing_subscriptions_vendor_unique" ON "billing_subscriptions" ("vendor_subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_subscriptions_current_user_unique" ON "billing_subscriptions" ("user_id") WHERE "current";--> statement-breakpoint
CREATE INDEX "billing_subscriptions_user_idx" ON "billing_subscriptions" ("user_id");--> statement-breakpoint
CREATE INDEX "usage_reservations_actor_source_idx" ON "usage_reservations" ("actor_id","kind","source");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_reservations_free_binding_unique" ON "usage_reservations" ("actor_id") WHERE "binds_free_judge" and "binding_released_at" is null;--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "account_entitlement_grants" ADD CONSTRAINT "account_entitlement_grants_validity_check" CHECK (
      ("source" = 'beta' and "starts_at" is null and "expires_at" is null)
      or ("source" = 'subscription' and "starts_at" is not null and "expires_at" is not null
        and isfinite("starts_at") and isfinite("expires_at") and "starts_at" < "expires_at")
    );--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD CONSTRAINT "usage_reservations_reserved_at_check" CHECK (isfinite("reserved_at"));--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD CONSTRAINT "usage_reservations_state_check" CHECK (coalesce(case "state"->>'kind'
      when 'reserved' then "state"='{"kind":"reserved"}'::jsonb
      when 'released' then "state"-array['kind','releasedAt']='{}'::jsonb
        and jsonb_typeof("state"->'releasedAt')='string'
        and isfinite(("state"->>'releasedAt')::timestamptz)
        and ("state"->>'releasedAt')::timestamptz>="reserved_at"
      when 'dispatched' then "state"-array['kind','countedAt']='{}'::jsonb
      when 'unknown' then "state"-array['kind','countedAt']='{}'::jsonb
      when 'delivered' then "state"-array['kind','countedAt']='{}'::jsonb
      when 'refunded' then "state"-array['kind','countedAt','refundedAt']='{}'::jsonb
        and jsonb_typeof("state"->'refundedAt')='string'
        and isfinite(("state"->>'refundedAt')::timestamptz)
        and ("state"->>'refundedAt')::timestamptz>=("state"->>'countedAt')::timestamptz
      when 'credited' then "kind"='ai_round'
        and "state"-array['kind','countedAt','creditedAt','provenance','providerOutcome']='{}'::jsonb
        and jsonb_typeof("state"->'creditedAt')='string'
        and isfinite(("state"->>'creditedAt')::timestamptz)
        and ("state"->>'creditedAt')::timestamptz>=("state"->>'countedAt')::timestamptz
        and "state"->>'providerOutcome' in ('dispatched','unknown','delivered','definite_failure')
        and jsonb_typeof("state"->'provenance')='object'
        and case "state"->'provenance'->>'kind'
          when 'recovery_bound' then ("state"->'provenance')-array['kind','incidentId']='{}'::jsonb
            and "state"->'provenance'->>'incidentId' ~ '^[a-z][a-z0-9]{23}$'
          when 'capture_shortfall' then ("state"->'provenance')-array['kind','commandId','freezeRevision']='{}'::jsonb
            and "state"->'provenance'->>'commandId' ~ '^[a-z][a-z0-9]{23}$'
            and jsonb_typeof("state"->'provenance'->'freezeRevision')='number'
            and "state"->'provenance'->>'freezeRevision' ~ '^[1-9][0-9]*$'
          else false end
      else false end, false));--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD CONSTRAINT "usage_reservations_count_check" CHECK (coalesce(case
      when "state"->>'kind' in ('reserved','released') then not ("state" ? 'countedAt')
      else jsonb_typeof("state"->'countedAt')='string'
        and isfinite(("state"->>'countedAt')::timestamptz)
        and ("state"->>'countedAt')::timestamptz >= "reserved_at" end, false));--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD CONSTRAINT "usage_reservations_source_check" CHECK (coalesce(case "source"->>'kind'
      when 'lifetime' then "source"='{"kind":"lifetime"}'::jsonb
      when 'beta' then "source"-array['kind','startsAt','endsAt']='{}'::jsonb
      when 'subscription' then "source"-array['kind','subscriptionId','startsAt','endsAt']='{}'::jsonb
        and "source"->>'subscriptionId' ~ '^[a-z][a-z0-9]{23}$'
      else false end, false) and coalesce(
        "source"->>'kind'='lifetime' or (
          jsonb_typeof("source"->'startsAt')='string' and jsonb_typeof("source"->'endsAt')='string'
          and isfinite(("source"->>'startsAt')::timestamptz) and isfinite(("source"->>'endsAt')::timestamptz)
          and ("source"->>'startsAt')::timestamptz < ("source"->>'endsAt')::timestamptz), false));--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD CONSTRAINT "usage_reservations_binding_check" CHECK (
      (not "binds_free_judge" or ("kind"='ai_round' and "source"->>'kind'='lifetime')) and
      ("binding_released_at" is null or ("binds_free_judge" and "state"->>'kind'='released'
        and "binding_released_at">="reserved_at")));--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD CONSTRAINT "usage_reservations_source_is_object" CHECK (jsonb_typeof("source") = 'object');--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD CONSTRAINT "usage_reservations_state_is_object" CHECK (jsonb_typeof("state") = 'object');--> statement-breakpoint
ALTER TABLE "account_entitlement_grants" DROP CONSTRAINT "account_entitlement_grants_source_check", ADD CONSTRAINT "account_entitlement_grants_source_check" CHECK ("source" in ('beta', 'subscription'));--> statement-breakpoint
ALTER TABLE "usage_reservations" DROP CONSTRAINT "usage_reservations_kind_check", ADD CONSTRAINT "usage_reservations_kind_check" CHECK ("kind" in ('ai_round', 'casual_ai_judge', 'round_analysis'));
--> statement-breakpoint
-- Only state advances; no retry/refund/renewal can move an existing debit.
CREATE FUNCTION guard_usage_attribution() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id,NEW.actor_id,NEW.round_id,NEW.kind,NEW.source,NEW.reserved_at,NEW.binds_free_judge)
    IS DISTINCT FROM (OLD.id,OLD.actor_id,OLD.round_id,OLD.kind,OLD.source,OLD.reserved_at,OLD.binds_free_judge) THEN
    RAISE EXCEPTION 'usage attribution is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.binding_released_at IS NOT NULL AND NEW.binding_released_at IS DISTINCT FROM OLD.binding_released_at THEN
    RAISE EXCEPTION 'released binding is terminal' USING ERRCODE='23514';
  END IF;
  IF OLD.state ? 'countedAt' AND NEW.state->>'countedAt' IS DISTINCT FROM OLD.state->>'countedAt' THEN
    RAISE EXCEPTION 'original usage count is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.state->>'kind' IN ('released','refunded') AND NEW.state IS DISTINCT FROM OLD.state THEN
    RAISE EXCEPTION 'released or refunded use is terminal' USING ERRCODE='23514';
  END IF;
  IF OLD.state->>'kind'='credited' AND
    NEW.state-'providerOutcome' IS DISTINCT FROM OLD.state-'providerOutcome' THEN
    RAISE EXCEPTION 'original platform credit is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER usage_attribution_immutable BEFORE UPDATE ON usage_reservations
FOR EACH ROW EXECUTE FUNCTION guard_usage_attribution();
