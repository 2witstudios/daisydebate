-- Preserve recorded financial facts; deny fresh creation from equal-second ambiguity.
-- Claim acquisition records authority, not a vendor observation. Preserve all original guards.
CREATE OR REPLACE FUNCTION public.daisy_guard_billing_refund_action() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $billing_refund$
DECLARE checked timestamptz := clock_timestamp();
BEGIN
  IF NEW.admitted_at > checked
    OR (NEW.state->>'startedAt')::timestamptz > checked
    OR (NEW.state->>'observedAt')::timestamptz > checked
    OR (NEW.claim->>'claimedAt')::timestamptz > checked
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Refund evidence cannot be in the future';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id=NEW.user_id AND deleted_at=NEW.closed_at) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Refund action requires its original closed account';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF to_timestamp(NEW.paid_at_seconds) <= NEW.closed_at THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Ambiguous payment precision cannot admit an automatic refund';
    END IF;
    IF NEW.state <> '{"kind":"ready"}'::jsonb OR NEW.claim IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Refund admission cannot invent prior dispatch';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id,NEW.user_id,NEW.mode,NEW.vendor_customer_id,NEW.vendor_charge_id,NEW.vendor_invoice_id,
      NEW.vendor_subscription_id,NEW.amount_minor,NEW.currency,NEW.period_starts_at,NEW.period_ends_at,
      NEW.closed_at,NEW.paid_at_seconds,NEW.admitted_at)
    IS DISTINCT FROM (OLD.id,OLD.user_id,OLD.mode,OLD.vendor_customer_id,OLD.vendor_charge_id,OLD.vendor_invoice_id,
      OLD.vendor_subscription_id,OLD.amount_minor,OLD.currency,OLD.period_starts_at,OLD.period_ends_at,
      OLD.closed_at,OLD.paid_at_seconds,OLD.admitted_at)
    OR (OLD.state ? 'startedAt' AND NEW.state->>'startedAt' IS DISTINCT FROM OLD.state->>'startedAt')
    OR (OLD.state ? 'refundId' AND NEW.state->>'refundId' IS DISTINCT FROM OLD.state->>'refundId')
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Original refund identity, amount, period and possible execution are immutable';
  END IF;
  IF (OLD.state->>'kind'='ready' AND NEW.state->>'kind' NOT IN ('ready','unknown'))
    OR (OLD.state->>'kind'='unknown' AND NEW.state->>'kind' NOT IN ('unknown','known'))
    OR (OLD.state->>'kind'='known' AND NEW.state->>'kind'<>'known')
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Refund identity cannot be discarded or reset';
  END IF;
  IF NEW.claim IS NOT DISTINCT FROM OLD.claim THEN
    IF NEW.state IS DISTINCT FROM OLD.state THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Refund facts require a consumed current claim';
    END IF;
  ELSIF NEW.claim IS NOT NULL THEN
    IF NEW.claim->>'work'='create' AND to_timestamp(NEW.paid_at_seconds) <= NEW.closed_at THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Ambiguous payment precision cannot authorize refund creation';
    END IF;
    IF (OLD.state->>'kind'<>'ready' AND NEW.state IS DISTINCT FROM OLD.state)
      OR (OLD.state->>'kind'='ready' AND NEW.state IS DISTINCT FROM jsonb_build_object(
        'kind','unknown','startedAt',NEW.claim->>'claimedAt','retryAt',NEW.claim->>'claimedAt','afterRefundId',null))
    THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Acquiring a refund claim cannot change observed facts';
    END IF;
    IF (NEW.claim->>'expiresAt')::timestamptz <= checked
      OR (OLD.claim IS NOT NULL AND ((OLD.claim->>'expiresAt')::timestamptz > checked OR NEW.claim->>'id'=OLD.claim->>'id'))
    THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Refund recovery requires a fresh live claim';
    END IF;
  ELSIF OLD.claim IS NULL OR (OLD.claim->>'expiresAt')::timestamptz <= checked THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Refund observation requires a current claim';
  ELSIF NEW.state IS DISTINCT FROM OLD.state AND NEW.state->>'kind'='known'
    AND (NEW.state->>'observedAt')::timestamptz < (OLD.claim->>'claimedAt')::timestamptz THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Refund observation cannot precede its claim';
  END IF;
  RETURN NEW;
END;
$billing_refund$;
