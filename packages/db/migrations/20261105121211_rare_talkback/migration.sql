CREATE TABLE "billing_purchases" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"mode" text NOT NULL,
	"price_id" text NOT NULL,
	"vendor_customer_id" text,
	"return_origin" text NOT NULL,
	"admitted_at" timestamp with time zone NOT NULL,
	"state" jsonb NOT NULL,
	CONSTRAINT "billing_purchases_mode_check" CHECK ("mode" in ('test', 'live')),
	CONSTRAINT "billing_purchases_identity_check" CHECK ("id" ~ '^[a-z0-9]{24}$'
    and "price_id" ~ '^price_[A-Za-z0-9_]+$' and length("price_id") <= 255
    and ("vendor_customer_id" is null or ("vendor_customer_id" ~ '^cus_[A-Za-z0-9_]+$' and length("vendor_customer_id") <= 255))),
	CONSTRAINT "billing_purchases_origin_check" CHECK ("return_origin" ~ '^https?://([a-z0-9.-]+|\[[a-f0-9:]+\])(:[1-9][0-9]{0,4})?$'),
	CONSTRAINT "billing_purchases_state_is_object" CHECK (jsonb_typeof("state") = 'object'),
	CONSTRAINT "billing_purchases_state_check" CHECK (coalesce(case "state"->>'kind'
    when 'admitted' then "state" = '{"kind":"admitted"}'::jsonb
    when 'abandoned' then "state" - array['kind','abandonedAt']::text[] = '{}'::jsonb
      and ("state"->>'abandonedAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
      and ("state"->>'abandonedAt')::timestamptz >= "admitted_at"
    else
      ("state"->>'startedAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
      and ("state"->>'startedAt')::timestamptz >= "admitted_at"
      and ("state"->>'startedAt')::timestamptz < "admitted_at" + interval '5 minutes'
      and case "state"->>'kind'
        when 'creating' then "state" - array['kind','startedAt','claim']::text[] = '{}'::jsonb
          and jsonb_typeof("state"->'claim')='object'
          and ("state"->'claim') - array['id','claimedAt','expiresAt']::text[] = '{}'::jsonb
          and jsonb_typeof("state"->'claim'->'id')='string'
          and ("state"->'claim'->>'id') ~ '^[a-z0-9]{24}$'
          and ("state"->'claim'->>'claimedAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
          and ("state"->'claim'->>'expiresAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
          and ("state"->'claim'->>'claimedAt')::timestamptz >= ("state"->>'startedAt')::timestamptz
          and ("state"->'claim'->>'expiresAt')::timestamptz > ("state"->'claim'->>'claimedAt')::timestamptz
          and ("state"->'claim'->>'expiresAt')::timestamptz <= least(
            ("state"->'claim'->>'claimedAt')::timestamptz + interval '30 seconds', "admitted_at" + interval '5 minutes')
        when 'unknown' then "state" - array['kind','startedAt','retryAt','afterSessionId']::text[] = '{}'::jsonb
          and ("state"->>'retryAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
          and ("state"->>'retryAt')::timestamptz >= ("state"->>'startedAt')::timestamptz
          and ("state"->'afterSessionId'='null'::jsonb or (jsonb_typeof("state"->'afterSessionId')='string'
            and ("state"->>'afterSessionId') ~ ('^cs_' || "mode" || '_[A-Za-z0-9_]+$')
            and length("state"->>'afterSessionId') <= 255))
        when 'open' then "state" - array['kind','startedAt','sessionId','customerId']::text[] = '{}'::jsonb
        when 'expired' then "state" - array['kind','startedAt','sessionId','customerId']::text[] = '{}'::jsonb
        when 'complete' then "state" - array['kind','startedAt','sessionId','customerId','subscriptionId']::text[] = '{}'::jsonb
          and jsonb_typeof("state"->'subscriptionId')='string'
          and ("state"->>'subscriptionId') ~ '^sub_[A-Za-z0-9_]+$' and length("state"->>'subscriptionId') <= 255
          and jsonb_typeof("state"->'customerId')='string'
        else false end
    end, false)),
	CONSTRAINT "billing_purchases_session_check" CHECK (coalesce("state"->>'kind' not in ('open','expired','complete') or (
    jsonb_typeof("state"->'sessionId')='string'
    and ("state"->>'sessionId') ~ ('^cs_' || "mode" || '_[A-Za-z0-9_]+$')
    and length("state"->>'sessionId') <= 255
    and ("state"->'customerId'='null'::jsonb or (jsonb_typeof("state"->'customerId')='string'
      and ("state"->>'customerId') ~ '^cus_[A-Za-z0-9_]+$' and length("state"->>'customerId') <= 255))
    and ("vendor_customer_id" is null or "vendor_customer_id"="state"->>'customerId')
  ), false))
);
--> statement-breakpoint
CREATE INDEX "billing_purchases_user_idx" ON "billing_purchases" ("user_id","admitted_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_purchases_pending_user_unique" ON "billing_purchases" ("user_id") WHERE "state"->>'kind' in ('admitted','creating','unknown','open');--> statement-breakpoint
CREATE UNIQUE INDEX "billing_purchases_session_unique" ON "billing_purchases" (("state"->>'sessionId'));--> statement-breakpoint
CREATE INDEX "billing_purchases_mode_discovery_idx" ON "billing_purchases" ("mode","id") WHERE "state"->>'kind' in ('creating','unknown','open','complete');--> statement-breakpoint
ALTER TABLE "billing_purchases" ADD CONSTRAINT "billing_purchases_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT;
--> statement-breakpoint
CREATE FUNCTION public.daisy_guard_billing_purchase() RETURNS trigger
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
  IF (NEW.id, NEW.user_id, NEW.mode, NEW.price_id, NEW.vendor_customer_id, NEW.return_origin, NEW.admitted_at)
    IS DISTINCT FROM (OLD.id, OLD.user_id, OLD.mode, OLD.price_id, OLD.vendor_customer_id, OLD.return_origin, OLD.admitted_at)
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
--> statement-breakpoint
CREATE TRIGGER billing_purchase_identity BEFORE INSERT OR UPDATE ON public.billing_purchases
FOR EACH ROW EXECUTE FUNCTION public.daisy_guard_billing_purchase();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_guard_billing_purchase() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON public.billing_purchases FROM PUBLIC, daisy_realtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_purchases TO daisy_web;
