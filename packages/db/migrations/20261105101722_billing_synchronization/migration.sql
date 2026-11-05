CREATE TABLE "billing_customers" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"vendor_customer_id" text NOT NULL,
	"mode" text NOT NULL,
	"synchronization" jsonb NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_customers_mode_check" CHECK ("mode" in ('test', 'live')),
	CONSTRAINT "billing_customers_vendor_check" CHECK ("vendor_customer_id" ~ '^cus_[A-Za-z0-9]+$' and length("vendor_customer_id") <= 255),
	CONSTRAINT "billing_customers_closure_check" CHECK ("closed_at" is null or "closed_at" >= "created_at"),
	CONSTRAINT "billing_customers_synchronization_is_object" CHECK (jsonb_typeof("synchronization") = 'object'),
	CONSTRAINT "billing_customers_synchronization_check" CHECK (coalesce(
    jsonb_typeof("synchronization"->'revision')='number'
    and ("synchronization"->>'revision') ~ '^[1-9][0-9]*$'
    and ("synchronization"->>'revision')::numeric <= 9007199254740991
    and case "synchronization"->>'kind'
      when 'pending' then "synchronization" - array['kind','revision','requestedAt','retryAt']::text[] = '{}'::jsonb
        and ("synchronization"->>'requestedAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
        and ("synchronization"->>'retryAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
        and ("synchronization"->>'requestedAt')::timestamptz <= ("synchronization"->>'retryAt')::timestamptz
      when 'claimed' then "synchronization" - array['kind','revision','requestedAt','claim']::text[] = '{}'::jsonb
        and jsonb_typeof("synchronization"->'claim')='object'
        and ("synchronization"->'claim') - array['id','claimedAt','expiresAt']::text[] = '{}'::jsonb
        and jsonb_typeof("synchronization"->'claim'->'id')='string'
        and ("synchronization"->'claim'->>'id') ~ '^[a-z0-9]{24}$'
        and ("synchronization"->>'requestedAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
        and ("synchronization"->'claim'->>'claimedAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
        and ("synchronization"->'claim'->>'expiresAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
        and ("synchronization"->>'requestedAt')::timestamptz <= ("synchronization"->'claim'->>'claimedAt')::timestamptz
        and ("synchronization"->'claim'->>'claimedAt')::timestamptz < ("synchronization"->'claim'->>'expiresAt')::timestamptz
        and ("synchronization"->'claim'->>'expiresAt')::timestamptz <= ("synchronization"->'claim'->>'claimedAt')::timestamptz + interval '30 seconds'
      when 'settled' then "synchronization" - array['kind','revision','observedAt','nextAt']::text[] = '{}'::jsonb
        and ("synchronization"->>'observedAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
        and ("synchronization"->>'nextAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
        and ("synchronization"->>'observedAt')::timestamptz <= ("synchronization"->>'nextAt')::timestamptz
      else false end, false))
);
--> statement-breakpoint
CREATE TABLE "billing_webhook_events" (
	"id" text PRIMARY KEY,
	"vendor_event_id" text NOT NULL,
	"vendor_customer_id" text NOT NULL,
	"mode" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone,
	CONSTRAINT "billing_webhook_events_mode_check" CHECK ("mode" in ('test', 'live')),
	CONSTRAINT "billing_webhook_events_identity_check" CHECK ("vendor_event_id" ~ '^evt_[A-Za-z0-9]+$' and length("vendor_event_id")<=255 and "vendor_customer_id" ~ '^cus_[A-Za-z0-9]+$' and length("vendor_customer_id")<=255),
	CONSTRAINT "billing_webhook_events_notification_check" CHECK ("notified_at" is null or "notified_at" >= "received_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "billing_customers_user_unique" ON "billing_customers" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_customers_vendor_unique" ON "billing_customers" ("mode","vendor_customer_id");--> statement-breakpoint
CREATE INDEX "billing_customers_closed_idx" ON "billing_customers" ("closed_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_webhook_events_vendor_unique" ON "billing_webhook_events" ("mode","vendor_event_id");--> statement-breakpoint
CREATE INDEX "billing_webhook_events_customer_idx" ON "billing_webhook_events" ("mode","vendor_customer_id");--> statement-breakpoint
CREATE INDEX "billing_webhook_events_pending_idx" ON "billing_webhook_events" ("id") WHERE "notified_at" is null;--> statement-breakpoint
CREATE INDEX "billing_webhook_events_retention_idx" ON "billing_webhook_events" ("received_at","id");--> statement-breakpoint
ALTER TABLE "billing_customers" ADD CONSTRAINT "billing_customers_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT;
--> statement-breakpoint
CREATE FUNCTION public.daisy_guard_billing_customer() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $billing_customer$
BEGIN
  IF (NEW.id, NEW.user_id, NEW.vendor_customer_id, NEW.mode, NEW.created_at)
    IS DISTINCT FROM (OLD.id, OLD.user_id, OLD.vendor_customer_id, OLD.mode, OLD.created_at)
    OR (OLD.closed_at IS NOT NULL AND NEW.closed_at IS DISTINCT FROM OLD.closed_at)
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Billing customer identity is immutable';
  END IF;
  RETURN NEW;
END;
$billing_customer$;
--> statement-breakpoint
CREATE TRIGGER billing_customer_identity BEFORE UPDATE ON public.billing_customers
FOR EACH ROW EXECUTE FUNCTION public.daisy_guard_billing_customer();
--> statement-breakpoint
CREATE FUNCTION public.daisy_guard_billing_subscription() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $billing_subscription$
BEGIN
  IF (NEW.id, NEW.user_id, NEW.vendor_subscription_id, NEW.created_at)
    IS DISTINCT FROM (OLD.id, OLD.user_id, OLD.vendor_subscription_id, OLD.created_at)
    OR (OLD.evidence->>'lifecycle' IN ('canceled','incomplete_expired')
      AND NEW.evidence->>'lifecycle' IS DISTINCT FROM OLD.evidence->>'lifecycle')
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Billing subscription identity and terminal status are immutable';
  END IF;
  RETURN NEW;
END;
$billing_subscription$;
--> statement-breakpoint
CREATE TRIGGER billing_subscription_identity BEFORE UPDATE ON public.billing_subscriptions
FOR EACH ROW EXECUTE FUNCTION public.daisy_guard_billing_subscription();
--> statement-breakpoint
CREATE FUNCTION public.daisy_guard_billing_receipt() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $billing_receipt$
BEGIN
  IF (NEW.id, NEW.vendor_event_id, NEW.vendor_customer_id, NEW.mode, NEW.received_at)
    IS DISTINCT FROM (OLD.id, OLD.vendor_event_id, OLD.vendor_customer_id, OLD.mode, OLD.received_at)
    OR (OLD.notified_at IS NOT NULL AND NEW.notified_at IS DISTINCT FROM OLD.notified_at)
  THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Billing receipt identity is immutable';
  END IF;
  RETURN NEW;
END;
$billing_receipt$;
--> statement-breakpoint
CREATE TRIGGER billing_receipt_identity BEFORE UPDATE ON public.billing_webhook_events
FOR EACH ROW EXECUTE FUNCTION public.daisy_guard_billing_receipt();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_guard_billing_customer(), public.daisy_guard_billing_subscription(), public.daisy_guard_billing_receipt() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON public.billing_customers, public.billing_webhook_events FROM PUBLIC, daisy_realtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_customers, public.billing_webhook_events TO daisy_web;
