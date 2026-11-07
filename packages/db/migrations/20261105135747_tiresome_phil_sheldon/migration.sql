CREATE TABLE "billing_refund_actions" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"mode" text NOT NULL,
	"vendor_customer_id" text NOT NULL,
	"vendor_charge_id" text NOT NULL,
	"vendor_invoice_id" text NOT NULL,
	"vendor_subscription_id" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"period_starts_at" timestamp with time zone NOT NULL,
	"period_ends_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone NOT NULL,
	"paid_at_seconds" bigint NOT NULL,
	"admitted_at" timestamp with time zone NOT NULL,
	"state" jsonb NOT NULL,
	"claim" jsonb,
	CONSTRAINT "billing_refund_actions_mode_check" CHECK ("mode" in ('test', 'live')),
	CONSTRAINT "billing_refund_actions_identity_check" CHECK ("id" ~ '^[a-z0-9]{24}$'
    and "vendor_customer_id" ~ '^cus_[A-Za-z0-9_]+$' and length("vendor_customer_id") <= 255
    and "vendor_charge_id" ~ '^ch_[A-Za-z0-9_]+$' and length("vendor_charge_id") <= 255
    and "vendor_invoice_id" ~ '^in_[A-Za-z0-9_]+$' and length("vendor_invoice_id") <= 255
    and "vendor_subscription_id" ~ '^sub_[A-Za-z0-9_]+$' and length("vendor_subscription_id") <= 255),
	CONSTRAINT "billing_refund_actions_payment_check" CHECK ("currency"='usd' and "amount_minor">0 and "amount_minor"<=9007199254740991
    and "period_starts_at"<"period_ends_at" and "paid_at_seconds">=0 and "paid_at_seconds"<=8640000000000
    and to_timestamp("paid_at_seconds")>="closed_at" and to_timestamp("paid_at_seconds")<="admitted_at"),
	CONSTRAINT "billing_refund_actions_state_is_object" CHECK (jsonb_typeof("state") = 'object'),
	CONSTRAINT "billing_refund_actions_claim_is_object" CHECK (jsonb_typeof("claim") = 'object'),
	CONSTRAINT "billing_refund_actions_state_check" CHECK (coalesce(case "state"->>'kind'
    when 'ready' then "state"='{"kind":"ready"}'::jsonb and "claim" is null
    else ("state"->>'startedAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
      and ("state"->>'startedAt')::timestamptz>="admitted_at"
      and case "state"->>'kind'
        when 'unknown' then "state"-array['kind','startedAt','retryAt','afterRefundId']::text[]='{}'::jsonb
          and ("state"->>'retryAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
          and ("state"->>'retryAt')::timestamptz>=("state"->>'startedAt')::timestamptz
          and ("state"->'afterRefundId'='null'::jsonb or (jsonb_typeof("state"->'afterRefundId')='string'
            and ("state"->>'afterRefundId') ~ '^re_[A-Za-z0-9_]+$' and length("state"->>'afterRefundId')<=255))
        when 'known' then "state"-array['kind','startedAt','refundId','status','observedAt']::text[]='{}'::jsonb
          and jsonb_typeof("state"->'refundId')='string' and ("state"->>'refundId') ~ '^re_[A-Za-z0-9_]+$' and length("state"->>'refundId')<=255
          and "state"->>'status' in ('pending','requires_action','succeeded','failed','canceled')
          and ("state"->>'observedAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
          and ("state"->>'observedAt')::timestamptz>=("state"->>'startedAt')::timestamptz
        else false end end,false)),
	CONSTRAINT "billing_refund_actions_claim_check" CHECK ("claim" is null or coalesce(
    "claim"-array['id','work','claimedAt','expiresAt']::text[]='{}'::jsonb
    and jsonb_typeof("claim"->'id')='string' and ("claim"->>'id') ~ '^[a-z0-9]{24}$'
    and ("claim"->>'claimedAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
    and ("claim"->>'expiresAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
    and ("claim"->>'claimedAt')::timestamptz>=("state"->>'startedAt')::timestamptz
    and ("claim"->>'expiresAt')::timestamptz>("claim"->>'claimedAt')::timestamptz
    and ("claim"->>'expiresAt')::timestamptz<=("claim"->>'claimedAt')::timestamptz+interval '30 seconds'
    and case "state"->>'kind'
      when 'known' then "claim"->>'work'='retrieve'
        and ("claim"->>'claimedAt')::timestamptz>=("state"->>'observedAt')::timestamptz
      when 'unknown' then ("claim"->>'claimedAt')::timestamptz>=("state"->>'retryAt')::timestamptz
        and case "claim"->>'work'
          when 'create' then ("claim"->>'expiresAt')::timestamptz<=("state"->>'startedAt')::timestamptz+interval '5 minutes'
          when 'discover' then ("claim"->>'claimedAt')::timestamptz>=("state"->>'startedAt')::timestamptz+interval '5 minutes'
          else false end
      else false end,false))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "billing_refund_actions_charge_unique" ON "billing_refund_actions" ("mode","vendor_charge_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_refund_actions_refund_unique" ON "billing_refund_actions" ("mode",("state"->>'refundId'));--> statement-breakpoint
CREATE INDEX "billing_refund_actions_user_idx" ON "billing_refund_actions" ("user_id","id");--> statement-breakpoint
CREATE INDEX "billing_refund_actions_mode_idx" ON "billing_refund_actions" ("mode","id");--> statement-breakpoint
ALTER TABLE "billing_refund_actions" ADD CONSTRAINT "billing_refund_actions_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT;
--> statement-breakpoint
CREATE FUNCTION public.daisy_guard_billing_refund_action() RETURNS trigger
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
    IF (NEW.claim->>'expiresAt')::timestamptz <= checked
      OR (OLD.claim IS NOT NULL AND ((OLD.claim->>'expiresAt')::timestamptz > checked OR NEW.claim->>'id'=OLD.claim->>'id'))
    THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Refund recovery requires a fresh live claim';
    END IF;
  ELSIF OLD.claim IS NULL OR (OLD.claim->>'expiresAt')::timestamptz <= checked THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Refund observation requires a current claim';
  END IF;
  RETURN NEW;
END;
$billing_refund$;
--> statement-breakpoint
CREATE TRIGGER billing_refund_action_identity BEFORE INSERT OR UPDATE ON public.billing_refund_actions
FOR EACH ROW EXECUTE FUNCTION public.daisy_guard_billing_refund_action();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_guard_billing_refund_action() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON public.billing_refund_actions FROM PUBLIC, daisy_realtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.billing_refund_actions TO daisy_web;
--> statement-breakpoint
REVOKE DELETE ON public.billing_refund_actions FROM daisy_web;
