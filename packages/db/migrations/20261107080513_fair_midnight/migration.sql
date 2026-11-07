-- Canonical main99 -> Billing. Drain old analysis/web workers before eventual cutover.
-- Shared/main history remains immutable; old private113 receipts retain original scope.
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
CREATE TABLE "billing_payment_observations" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"mode" text NOT NULL,
	"vendor_customer_id" text NOT NULL,
	"vendor_invoice_id" text NOT NULL,
	"kind" text NOT NULL,
	"vendor_invoice_payment_id" text,
	"refund_action_id" text,
	"source" jsonb NOT NULL,
	"state" jsonb NOT NULL,
	"closed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "billing_payment_observations_mode_check" CHECK ("mode" in ('test', 'live')),
	CONSTRAINT "billing_payment_observations_identity_check" CHECK (coalesce("id" ~ '^[a-z0-9]{24}$'
      and "vendor_customer_id" ~ '^cus_[A-Za-z0-9_]+$' and length("vendor_customer_id")<=255
      and "vendor_invoice_id" ~ '^in_[A-Za-z0-9_]+$' and length("vendor_invoice_id")<=255
      and case "kind" when 'invoice' then "vendor_invoice_payment_id" is null and "refund_action_id" is null
        when 'payment' then "vendor_invoice_payment_id" ~ '^inpay_[A-Za-z0-9_]+$' and length("vendor_invoice_payment_id")<=255
        else false end,false)),
	CONSTRAINT "billing_payment_observations_time_check" CHECK ("closed_at"<="created_at" and "created_at"<="observed_at"),
	CONSTRAINT "billing_payment_observations_source_is_object" CHECK (jsonb_typeof("source") = 'object'),
	CONSTRAINT "billing_payment_observations_state_is_object" CHECK (jsonb_typeof("state") = 'object'),
	CONSTRAINT "billing_payment_observations_source_check" CHECK (coalesce(
    ("source"->'vendorSubscriptionId'='null'::jsonb or (jsonb_typeof("source"->'vendorSubscriptionId')='string'
      and ("source"->>'vendorSubscriptionId') ~ '^sub_[A-Za-z0-9_]+$' and length("source"->>'vendorSubscriptionId')<=255))
    and ("source"->'priceId'='null'::jsonb or (jsonb_typeof("source"->'priceId')='string'
      and ("source"->>'priceId') ~ '^price_[A-Za-z0-9_]+$' and length("source"->>'priceId')<=255))
    and case "source"->>'kind'
      when 'unresolved' then "source"-array['kind','vendorSubscriptionId','priceId']::text[]='{}'::jsonb
      when 'purchase' then "source"-array['kind','purchaseId','vendorSubscriptionId','priceId','admittedAt']::text[]='{}'::jsonb
        and jsonb_typeof("source"->'vendorSubscriptionId')='string' and jsonb_typeof("source"->'priceId')='string'
        and jsonb_typeof("source"->'purchaseId')='string' and ("source"->>'purchaseId') ~ '^[a-z0-9]{24}$'
        and ("source"->>'admittedAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$' and ("source"->>'admittedAt')::timestamptz<="closed_at"
      else false end,false)),
	CONSTRAINT "billing_payment_observations_state_check" CHECK (coalesce(case "kind" when 'invoice' then case "state"->>'kind'
    when 'owed' then "state"-array['kind','reason']::text[]='{}'::jsonb and "state"->>'reason' in ('enumeration_unavailable','conflicting_evidence')
    when 'resolved' then "state"-array['kind','basis','paymentCount','lastPaymentId']::text[]='{}'::jsonb
      and "state"->>'basis'='enumeration_retained' and jsonb_typeof(("state"->'paymentCount'))='number'
  and (("state"->'paymentCount')#>>'{}') ~ '^[0-9]+$' and (("state"->'paymentCount')#>>'{}')::numeric<=9007199254740991
      and ("state"->>'paymentCount')::numeric>0 and ("state"->>'lastPaymentId') ~ '^inpay_[A-Za-z0-9_]+$' and length("state"->>'lastPaymentId')<=255
    else false end
    when 'payment' then case "state"->>'kind'
      when 'owed' then "state"-array['kind','reason','evidence']::text[]='{}'::jsonb
        and "state"->>'reason' in ('payment_unresolved','chronology_ambiguous','refund_required','conflicting_evidence')
        and jsonb_typeof(("state"->'evidence'))='object' and case ("state"->'evidence')->>'kind'
    when 'partial' then ("state"->'evidence')-array['kind','facts']::text[]='{}'::jsonb and jsonb_typeof((("state"->'evidence')->'facts'))='object' and (("state"->'evidence')->'facts')-array['status','paidAtSeconds','amountPaidMinor','charge','period']::text[]='{}'::jsonb
    and ((("state"->'evidence')->'facts')->'status'='null'::jsonb or (("state"->'evidence')->'facts')->>'status' in ('open','paid','canceled'))
    and ((("state"->'evidence')->'facts')->'paidAtSeconds'='null'::jsonb or jsonb_typeof(((("state"->'evidence')->'facts')->'paidAtSeconds'))='number'
  and (((("state"->'evidence')->'facts')->'paidAtSeconds')#>>'{}') ~ '^[0-9]+$' and (((("state"->'evidence')->'facts')->'paidAtSeconds')#>>'{}')::numeric<=9007199254740)
    and ((("state"->'evidence')->'facts')->'amountPaidMinor'='null'::jsonb or jsonb_typeof(((("state"->'evidence')->'facts')->'amountPaidMinor'))='number'
  and (((("state"->'evidence')->'facts')->'amountPaidMinor')#>>'{}') ~ '^[0-9]+$' and (((("state"->'evidence')->'facts')->'amountPaidMinor')#>>'{}')::numeric<=9007199254740991)
    and ((("state"->'evidence')->'facts')->'period'='null'::jsonb or jsonb_typeof(((("state"->'evidence')->'facts')->'period'))='object'
  and ((("state"->'evidence')->'facts')->'period')-array['startsAt','endsAt']::text[]='{}'::jsonb
  and (((("state"->'evidence')->'facts')->'period')->>'startsAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$' and (((("state"->'evidence')->'facts')->'period')->>'endsAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
  and (((("state"->'evidence')->'facts')->'period')->>'startsAt')::timestamptz<(((("state"->'evidence')->'facts')->'period')->>'endsAt')::timestamptz)
    and case ((("state"->'evidence')->'facts')->'charge')->>'kind' when 'unresolved' then ((("state"->'evidence')->'facts')->'charge')='{"kind":"unresolved"}'::jsonb
      when 'observed' then ((("state"->'evidence')->'facts')->'charge')-array['kind','id','paid','capturedMinor','currency']::text[]='{}'::jsonb
        and jsonb_typeof(((("state"->'evidence')->'facts')->'charge')->'id')='string' and (((("state"->'evidence')->'facts')->'charge')->>'id') ~ '^ch_[A-Za-z0-9_]+$' and length(((("state"->'evidence')->'facts')->'charge')->>'id')<=255
        and (((("state"->'evidence')->'facts')->'charge')->'paid'='null'::jsonb or jsonb_typeof(((("state"->'evidence')->'facts')->'charge')->'paid')='boolean')
        and (((("state"->'evidence')->'facts')->'charge')->'capturedMinor'='null'::jsonb or jsonb_typeof((((("state"->'evidence')->'facts')->'charge')->'capturedMinor'))='number'
  and ((((("state"->'evidence')->'facts')->'charge')->'capturedMinor')#>>'{}') ~ '^[0-9]+$' and ((((("state"->'evidence')->'facts')->'charge')->'capturedMinor')#>>'{}')::numeric<=9007199254740991)
        and (((("state"->'evidence')->'facts')->'charge')->'currency'='null'::jsonb or (jsonb_typeof(((("state"->'evidence')->'facts')->'charge')->'currency')='string' and (((("state"->'evidence')->'facts')->'charge')->>'currency') ~ '^[a-z]{3}$'))
      else false end
    when 'verified' then ("state"->'evidence')-array['kind','payment']::text[]='{}'::jsonb and jsonb_typeof((("state"->'evidence')->'payment'))='object' and "source"->>'kind'='purchase'
    and (("state"->'evidence')->'payment')->>'mode'="mode" and (("state"->'evidence')->'payment')->>'customerId'="vendor_customer_id"
    and (("state"->'evidence')->'payment')->>'invoiceId'="vendor_invoice_id" and (("state"->'evidence')->'payment')->>'invoicePaymentId'="vendor_invoice_payment_id"
    and (("state"->'evidence')->'payment')->>'vendorSubscriptionId'="source"->>'vendorSubscriptionId' and (("state"->'evidence')->'payment')->>'priceId'="source"->>'priceId'
    and jsonb_typeof(((("state"->'evidence')->'payment')->'paidAtSeconds'))='number'
  and (((("state"->'evidence')->'payment')->'paidAtSeconds')#>>'{}') ~ '^[0-9]+$' and (((("state"->'evidence')->'payment')->'paidAtSeconds')#>>'{}')::numeric<=9007199254740
    and (("state"->'evidence')->'payment')-array['mode','customerId','invoiceId','invoicePaymentId','vendorSubscriptionId','priceId','chargeId','amountMinor','currency','paidAtSeconds','period']::text[]='{}'::jsonb
    and jsonb_typeof((("state"->'evidence')->'payment')->'chargeId')='string' and ((("state"->'evidence')->'payment')->>'chargeId') ~ '^ch_[A-Za-z0-9_]+$' and length((("state"->'evidence')->'payment')->>'chargeId')<=255
    and jsonb_typeof(((("state"->'evidence')->'payment')->'amountMinor'))='number'
  and (((("state"->'evidence')->'payment')->'amountMinor')#>>'{}') ~ '^[0-9]+$' and (((("state"->'evidence')->'payment')->'amountMinor')#>>'{}')::numeric<=9007199254740991 and ((("state"->'evidence')->'payment')->>'amountMinor')::numeric>0
    and (("state"->'evidence')->'payment')->>'currency'='usd' and jsonb_typeof(((("state"->'evidence')->'payment')->'period'))='object'
  and ((("state"->'evidence')->'payment')->'period')-array['startsAt','endsAt']::text[]='{}'::jsonb
  and (((("state"->'evidence')->'payment')->'period')->>'startsAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$' and (((("state"->'evidence')->'payment')->'period')->>'endsAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
  and (((("state"->'evidence')->'payment')->'period')->>'startsAt')::timestamptz<(((("state"->'evidence')->'payment')->'period')->>'endsAt')::timestamptz
    when 'chronology' then ("state"->'evidence')-array['kind','proof','facts']::text[]='{}'::jsonb
      and (("state"->'evidence')->'proof')-array['mode','customerId','invoiceId','invoicePaymentId','vendorSubscriptionId','priceId','status','paidAtSeconds']::text[]='{}'::jsonb
      and "source"->>'kind'='purchase'
    and (("state"->'evidence')->'proof')->>'mode'="mode" and (("state"->'evidence')->'proof')->>'customerId'="vendor_customer_id"
    and (("state"->'evidence')->'proof')->>'invoiceId'="vendor_invoice_id" and (("state"->'evidence')->'proof')->>'invoicePaymentId'="vendor_invoice_payment_id"
    and (("state"->'evidence')->'proof')->>'vendorSubscriptionId'="source"->>'vendorSubscriptionId' and (("state"->'evidence')->'proof')->>'priceId'="source"->>'priceId'
    and jsonb_typeof(((("state"->'evidence')->'proof')->'paidAtSeconds'))='number'
  and (((("state"->'evidence')->'proof')->'paidAtSeconds')#>>'{}') ~ '^[0-9]+$' and (((("state"->'evidence')->'proof')->'paidAtSeconds')#>>'{}')::numeric<=9007199254740 and (("state"->'evidence')->'proof')->>'status'='paid' and to_timestamp(((("state"->'evidence')->'proof')->>'paidAtSeconds')::double precision)+interval '1 second'<="closed_at"
    and to_timestamp(((("state"->'evidence')->'proof')->>'paidAtSeconds')::double precision)<="observed_at"
      and jsonb_typeof((("state"->'evidence')->'facts'))='object' and (("state"->'evidence')->'facts')-array['status','paidAtSeconds','amountPaidMinor','charge','period']::text[]='{}'::jsonb
    and ((("state"->'evidence')->'facts')->'status'='null'::jsonb or (("state"->'evidence')->'facts')->>'status' in ('open','paid','canceled'))
    and ((("state"->'evidence')->'facts')->'paidAtSeconds'='null'::jsonb or jsonb_typeof(((("state"->'evidence')->'facts')->'paidAtSeconds'))='number'
  and (((("state"->'evidence')->'facts')->'paidAtSeconds')#>>'{}') ~ '^[0-9]+$' and (((("state"->'evidence')->'facts')->'paidAtSeconds')#>>'{}')::numeric<=9007199254740)
    and ((("state"->'evidence')->'facts')->'amountPaidMinor'='null'::jsonb or jsonb_typeof(((("state"->'evidence')->'facts')->'amountPaidMinor'))='number'
  and (((("state"->'evidence')->'facts')->'amountPaidMinor')#>>'{}') ~ '^[0-9]+$' and (((("state"->'evidence')->'facts')->'amountPaidMinor')#>>'{}')::numeric<=9007199254740991)
    and ((("state"->'evidence')->'facts')->'period'='null'::jsonb or jsonb_typeof(((("state"->'evidence')->'facts')->'period'))='object'
  and ((("state"->'evidence')->'facts')->'period')-array['startsAt','endsAt']::text[]='{}'::jsonb
  and (((("state"->'evidence')->'facts')->'period')->>'startsAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$' and (((("state"->'evidence')->'facts')->'period')->>'endsAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
  and (((("state"->'evidence')->'facts')->'period')->>'startsAt')::timestamptz<(((("state"->'evidence')->'facts')->'period')->>'endsAt')::timestamptz)
    and case ((("state"->'evidence')->'facts')->'charge')->>'kind' when 'unresolved' then ((("state"->'evidence')->'facts')->'charge')='{"kind":"unresolved"}'::jsonb
      when 'observed' then ((("state"->'evidence')->'facts')->'charge')-array['kind','id','paid','capturedMinor','currency']::text[]='{}'::jsonb
        and jsonb_typeof(((("state"->'evidence')->'facts')->'charge')->'id')='string' and (((("state"->'evidence')->'facts')->'charge')->>'id') ~ '^ch_[A-Za-z0-9_]+$' and length(((("state"->'evidence')->'facts')->'charge')->>'id')<=255
        and (((("state"->'evidence')->'facts')->'charge')->'paid'='null'::jsonb or jsonb_typeof(((("state"->'evidence')->'facts')->'charge')->'paid')='boolean')
        and (((("state"->'evidence')->'facts')->'charge')->'capturedMinor'='null'::jsonb or jsonb_typeof((((("state"->'evidence')->'facts')->'charge')->'capturedMinor'))='number'
  and ((((("state"->'evidence')->'facts')->'charge')->'capturedMinor')#>>'{}') ~ '^[0-9]+$' and ((((("state"->'evidence')->'facts')->'charge')->'capturedMinor')#>>'{}')::numeric<=9007199254740991)
        and (((("state"->'evidence')->'facts')->'charge')->'currency'='null'::jsonb or (jsonb_typeof(((("state"->'evidence')->'facts')->'charge')->'currency')='string' and (((("state"->'evidence')->'facts')->'charge')->>'currency') ~ '^[a-z]{3}$'))
      else false end and ("state"->'evidence')->'facts'->>'status'='paid'
      and ("state"->'evidence')->'facts'->'paidAtSeconds'=(("state"->'evidence')->'proof')->'paidAtSeconds'
    else false end and ("refund_action_id" is null or
          ("state"->>'reason'='conflicting_evidence' and ("state"->'evidence')->>'kind'='verified'))
      when 'resolved' then "refund_action_id" is null and "state"-array['kind','basis','evidence']::text[]='{}'::jsonb
        and "state"->>'basis'='pre_closure' and jsonb_typeof(("state"->'evidence'))='object' and case ("state"->'evidence')->>'kind'
    when 'partial' then ("state"->'evidence')-array['kind','facts']::text[]='{}'::jsonb and jsonb_typeof((("state"->'evidence')->'facts'))='object' and (("state"->'evidence')->'facts')-array['status','paidAtSeconds','amountPaidMinor','charge','period']::text[]='{}'::jsonb
    and ((("state"->'evidence')->'facts')->'status'='null'::jsonb or (("state"->'evidence')->'facts')->>'status' in ('open','paid','canceled'))
    and ((("state"->'evidence')->'facts')->'paidAtSeconds'='null'::jsonb or jsonb_typeof(((("state"->'evidence')->'facts')->'paidAtSeconds'))='number'
  and (((("state"->'evidence')->'facts')->'paidAtSeconds')#>>'{}') ~ '^[0-9]+$' and (((("state"->'evidence')->'facts')->'paidAtSeconds')#>>'{}')::numeric<=9007199254740)
    and ((("state"->'evidence')->'facts')->'amountPaidMinor'='null'::jsonb or jsonb_typeof(((("state"->'evidence')->'facts')->'amountPaidMinor'))='number'
  and (((("state"->'evidence')->'facts')->'amountPaidMinor')#>>'{}') ~ '^[0-9]+$' and (((("state"->'evidence')->'facts')->'amountPaidMinor')#>>'{}')::numeric<=9007199254740991)
    and ((("state"->'evidence')->'facts')->'period'='null'::jsonb or jsonb_typeof(((("state"->'evidence')->'facts')->'period'))='object'
  and ((("state"->'evidence')->'facts')->'period')-array['startsAt','endsAt']::text[]='{}'::jsonb
  and (((("state"->'evidence')->'facts')->'period')->>'startsAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$' and (((("state"->'evidence')->'facts')->'period')->>'endsAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
  and (((("state"->'evidence')->'facts')->'period')->>'startsAt')::timestamptz<(((("state"->'evidence')->'facts')->'period')->>'endsAt')::timestamptz)
    and case ((("state"->'evidence')->'facts')->'charge')->>'kind' when 'unresolved' then ((("state"->'evidence')->'facts')->'charge')='{"kind":"unresolved"}'::jsonb
      when 'observed' then ((("state"->'evidence')->'facts')->'charge')-array['kind','id','paid','capturedMinor','currency']::text[]='{}'::jsonb
        and jsonb_typeof(((("state"->'evidence')->'facts')->'charge')->'id')='string' and (((("state"->'evidence')->'facts')->'charge')->>'id') ~ '^ch_[A-Za-z0-9_]+$' and length(((("state"->'evidence')->'facts')->'charge')->>'id')<=255
        and (((("state"->'evidence')->'facts')->'charge')->'paid'='null'::jsonb or jsonb_typeof(((("state"->'evidence')->'facts')->'charge')->'paid')='boolean')
        and (((("state"->'evidence')->'facts')->'charge')->'capturedMinor'='null'::jsonb or jsonb_typeof((((("state"->'evidence')->'facts')->'charge')->'capturedMinor'))='number'
  and ((((("state"->'evidence')->'facts')->'charge')->'capturedMinor')#>>'{}') ~ '^[0-9]+$' and ((((("state"->'evidence')->'facts')->'charge')->'capturedMinor')#>>'{}')::numeric<=9007199254740991)
        and (((("state"->'evidence')->'facts')->'charge')->'currency'='null'::jsonb or (jsonb_typeof(((("state"->'evidence')->'facts')->'charge')->'currency')='string' and (((("state"->'evidence')->'facts')->'charge')->>'currency') ~ '^[a-z]{3}$'))
      else false end
    when 'verified' then ("state"->'evidence')-array['kind','payment']::text[]='{}'::jsonb and jsonb_typeof((("state"->'evidence')->'payment'))='object' and "source"->>'kind'='purchase'
    and (("state"->'evidence')->'payment')->>'mode'="mode" and (("state"->'evidence')->'payment')->>'customerId'="vendor_customer_id"
    and (("state"->'evidence')->'payment')->>'invoiceId'="vendor_invoice_id" and (("state"->'evidence')->'payment')->>'invoicePaymentId'="vendor_invoice_payment_id"
    and (("state"->'evidence')->'payment')->>'vendorSubscriptionId'="source"->>'vendorSubscriptionId' and (("state"->'evidence')->'payment')->>'priceId'="source"->>'priceId'
    and jsonb_typeof(((("state"->'evidence')->'payment')->'paidAtSeconds'))='number'
  and (((("state"->'evidence')->'payment')->'paidAtSeconds')#>>'{}') ~ '^[0-9]+$' and (((("state"->'evidence')->'payment')->'paidAtSeconds')#>>'{}')::numeric<=9007199254740
    and (("state"->'evidence')->'payment')-array['mode','customerId','invoiceId','invoicePaymentId','vendorSubscriptionId','priceId','chargeId','amountMinor','currency','paidAtSeconds','period']::text[]='{}'::jsonb
    and jsonb_typeof((("state"->'evidence')->'payment')->'chargeId')='string' and ((("state"->'evidence')->'payment')->>'chargeId') ~ '^ch_[A-Za-z0-9_]+$' and length((("state"->'evidence')->'payment')->>'chargeId')<=255
    and jsonb_typeof(((("state"->'evidence')->'payment')->'amountMinor'))='number'
  and (((("state"->'evidence')->'payment')->'amountMinor')#>>'{}') ~ '^[0-9]+$' and (((("state"->'evidence')->'payment')->'amountMinor')#>>'{}')::numeric<=9007199254740991 and ((("state"->'evidence')->'payment')->>'amountMinor')::numeric>0
    and (("state"->'evidence')->'payment')->>'currency'='usd' and jsonb_typeof(((("state"->'evidence')->'payment')->'period'))='object'
  and ((("state"->'evidence')->'payment')->'period')-array['startsAt','endsAt']::text[]='{}'::jsonb
  and (((("state"->'evidence')->'payment')->'period')->>'startsAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$' and (((("state"->'evidence')->'payment')->'period')->>'endsAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
  and (((("state"->'evidence')->'payment')->'period')->>'startsAt')::timestamptz<(((("state"->'evidence')->'payment')->'period')->>'endsAt')::timestamptz
    when 'chronology' then ("state"->'evidence')-array['kind','proof','facts']::text[]='{}'::jsonb
      and (("state"->'evidence')->'proof')-array['mode','customerId','invoiceId','invoicePaymentId','vendorSubscriptionId','priceId','status','paidAtSeconds']::text[]='{}'::jsonb
      and "source"->>'kind'='purchase'
    and (("state"->'evidence')->'proof')->>'mode'="mode" and (("state"->'evidence')->'proof')->>'customerId'="vendor_customer_id"
    and (("state"->'evidence')->'proof')->>'invoiceId'="vendor_invoice_id" and (("state"->'evidence')->'proof')->>'invoicePaymentId'="vendor_invoice_payment_id"
    and (("state"->'evidence')->'proof')->>'vendorSubscriptionId'="source"->>'vendorSubscriptionId' and (("state"->'evidence')->'proof')->>'priceId'="source"->>'priceId'
    and jsonb_typeof(((("state"->'evidence')->'proof')->'paidAtSeconds'))='number'
  and (((("state"->'evidence')->'proof')->'paidAtSeconds')#>>'{}') ~ '^[0-9]+$' and (((("state"->'evidence')->'proof')->'paidAtSeconds')#>>'{}')::numeric<=9007199254740 and (("state"->'evidence')->'proof')->>'status'='paid' and to_timestamp(((("state"->'evidence')->'proof')->>'paidAtSeconds')::double precision)+interval '1 second'<="closed_at"
    and to_timestamp(((("state"->'evidence')->'proof')->>'paidAtSeconds')::double precision)<="observed_at"
      and jsonb_typeof((("state"->'evidence')->'facts'))='object' and (("state"->'evidence')->'facts')-array['status','paidAtSeconds','amountPaidMinor','charge','period']::text[]='{}'::jsonb
    and ((("state"->'evidence')->'facts')->'status'='null'::jsonb or (("state"->'evidence')->'facts')->>'status' in ('open','paid','canceled'))
    and ((("state"->'evidence')->'facts')->'paidAtSeconds'='null'::jsonb or jsonb_typeof(((("state"->'evidence')->'facts')->'paidAtSeconds'))='number'
  and (((("state"->'evidence')->'facts')->'paidAtSeconds')#>>'{}') ~ '^[0-9]+$' and (((("state"->'evidence')->'facts')->'paidAtSeconds')#>>'{}')::numeric<=9007199254740)
    and ((("state"->'evidence')->'facts')->'amountPaidMinor'='null'::jsonb or jsonb_typeof(((("state"->'evidence')->'facts')->'amountPaidMinor'))='number'
  and (((("state"->'evidence')->'facts')->'amountPaidMinor')#>>'{}') ~ '^[0-9]+$' and (((("state"->'evidence')->'facts')->'amountPaidMinor')#>>'{}')::numeric<=9007199254740991)
    and ((("state"->'evidence')->'facts')->'period'='null'::jsonb or jsonb_typeof(((("state"->'evidence')->'facts')->'period'))='object'
  and ((("state"->'evidence')->'facts')->'period')-array['startsAt','endsAt']::text[]='{}'::jsonb
  and (((("state"->'evidence')->'facts')->'period')->>'startsAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$' and (((("state"->'evidence')->'facts')->'period')->>'endsAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
  and (((("state"->'evidence')->'facts')->'period')->>'startsAt')::timestamptz<(((("state"->'evidence')->'facts')->'period')->>'endsAt')::timestamptz)
    and case ((("state"->'evidence')->'facts')->'charge')->>'kind' when 'unresolved' then ((("state"->'evidence')->'facts')->'charge')='{"kind":"unresolved"}'::jsonb
      when 'observed' then ((("state"->'evidence')->'facts')->'charge')-array['kind','id','paid','capturedMinor','currency']::text[]='{}'::jsonb
        and jsonb_typeof(((("state"->'evidence')->'facts')->'charge')->'id')='string' and (((("state"->'evidence')->'facts')->'charge')->>'id') ~ '^ch_[A-Za-z0-9_]+$' and length(((("state"->'evidence')->'facts')->'charge')->>'id')<=255
        and (((("state"->'evidence')->'facts')->'charge')->'paid'='null'::jsonb or jsonb_typeof(((("state"->'evidence')->'facts')->'charge')->'paid')='boolean')
        and (((("state"->'evidence')->'facts')->'charge')->'capturedMinor'='null'::jsonb or jsonb_typeof((((("state"->'evidence')->'facts')->'charge')->'capturedMinor'))='number'
  and ((((("state"->'evidence')->'facts')->'charge')->'capturedMinor')#>>'{}') ~ '^[0-9]+$' and ((((("state"->'evidence')->'facts')->'charge')->'capturedMinor')#>>'{}')::numeric<=9007199254740991)
        and (((("state"->'evidence')->'facts')->'charge')->'currency'='null'::jsonb or (jsonb_typeof(((("state"->'evidence')->'facts')->'charge')->'currency')='string' and (((("state"->'evidence')->'facts')->'charge')->>'currency') ~ '^[a-z]{3}$'))
      else false end and ("state"->'evidence')->'facts'->>'status'='paid'
      and ("state"->'evidence')->'facts'->'paidAtSeconds'=(("state"->'evidence')->'proof')->'paidAtSeconds'
    else false end
        and case ("state"->'evidence')->>'kind' when 'chronology' then true
          when 'verified' then to_timestamp(((("state"->'evidence')->'payment')->>'paidAtSeconds')::double precision)+interval '1 second'<="closed_at"
    and to_timestamp(((("state"->'evidence')->'payment')->>'paidAtSeconds')::double precision)<="observed_at" else false end
      when 'refund-linked' then "refund_action_id" is not null and "state"-array['kind','payment']::text[]='{}'::jsonb
        and jsonb_typeof(("state"->'payment'))='object' and "source"->>'kind'='purchase'
    and ("state"->'payment')->>'mode'="mode" and ("state"->'payment')->>'customerId'="vendor_customer_id"
    and ("state"->'payment')->>'invoiceId'="vendor_invoice_id" and ("state"->'payment')->>'invoicePaymentId'="vendor_invoice_payment_id"
    and ("state"->'payment')->>'vendorSubscriptionId'="source"->>'vendorSubscriptionId' and ("state"->'payment')->>'priceId'="source"->>'priceId'
    and jsonb_typeof((("state"->'payment')->'paidAtSeconds'))='number'
  and ((("state"->'payment')->'paidAtSeconds')#>>'{}') ~ '^[0-9]+$' and ((("state"->'payment')->'paidAtSeconds')#>>'{}')::numeric<=9007199254740
    and ("state"->'payment')-array['mode','customerId','invoiceId','invoicePaymentId','vendorSubscriptionId','priceId','chargeId','amountMinor','currency','paidAtSeconds','period']::text[]='{}'::jsonb
    and jsonb_typeof(("state"->'payment')->'chargeId')='string' and (("state"->'payment')->>'chargeId') ~ '^ch_[A-Za-z0-9_]+$' and length(("state"->'payment')->>'chargeId')<=255
    and jsonb_typeof((("state"->'payment')->'amountMinor'))='number'
  and ((("state"->'payment')->'amountMinor')#>>'{}') ~ '^[0-9]+$' and ((("state"->'payment')->'amountMinor')#>>'{}')::numeric<=9007199254740991 and (("state"->'payment')->>'amountMinor')::numeric>0
    and ("state"->'payment')->>'currency'='usd' and jsonb_typeof((("state"->'payment')->'period'))='object'
  and (("state"->'payment')->'period')-array['startsAt','endsAt']::text[]='{}'::jsonb
  and ((("state"->'payment')->'period')->>'startsAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$' and ((("state"->'payment')->'period')->>'endsAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
  and ((("state"->'payment')->'period')->>'startsAt')::timestamptz<((("state"->'payment')->'period')->>'endsAt')::timestamptz
        and to_timestamp(("state"->'payment'->>'paidAtSeconds')::double precision)<="observed_at"
      else false end else false end,false))
);
--> statement-breakpoint
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
ALTER TABLE "round_analyses" DROP CONSTRAINT "round_analyses_report_is_object";
--> statement-breakpoint
ALTER TABLE "round_analyses" DROP CONSTRAINT "round_analyses_status_check";
--> statement-breakpoint
ALTER TABLE "round_analyses" DROP CONSTRAINT "round_analyses_attempts_check";
--> statement-breakpoint
ALTER TABLE "round_analyses" DROP CONSTRAINT "round_analyses_result_check";
--> statement-breakpoint
ALTER TABLE "usage_reservations" DROP CONSTRAINT "usage_reservations_refund_check";
--> statement-breakpoint
ALTER TABLE "usage_reservations" DROP CONSTRAINT "usage_reservations_admission_check";
--> statement-breakpoint
DROP INDEX "round_analyses_lease_idx";
--> statement-breakpoint
DROP INDEX "usage_reservations_actor_period_idx";
--> statement-breakpoint
DROP INDEX "usage_reservations_counted_idx";
--> statement-breakpoint
ALTER TABLE "round_analyses" DROP CONSTRAINT "round_analyses_lease_check";
--> statement-breakpoint
ALTER TABLE "account_entitlement_grants" ADD COLUMN "starts_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "account_entitlement_grants" ADD COLUMN "expires_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "privacy_jobs" ADD COLUMN "billing_cleanup" jsonb;
--> statement-breakpoint
ALTER TABLE "round_analyses" ADD COLUMN "work" jsonb;
--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD COLUMN "source" jsonb;
--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD COLUMN "state" jsonb;
--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD COLUMN "binds_free_judge" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD COLUMN "binding_released_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "usage_reservations" DROP CONSTRAINT "usage_reservations_kind_check", ADD CONSTRAINT "usage_reservations_kind_check" CHECK ("kind" in ('ai_round', 'casual_ai_judge', 'round_analysis'));
--> statement-breakpoint
-- Preserve actual main rows before final NOT NULL/CHECK/identity guards.
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
WITH facts AS (
  SELECT u.id, u.state, r.status,
    CASE WHEN r.status NOT IN ('completed','abandoned') THEN 'unknown'
      ELSE outcome.value END AS outcome,
    CASE
      WHEN r.platform_ending='recovery_bound' AND incident.id IS NOT NULL
        THEN jsonb_build_object('kind','recovery_bound','incidentId',incident.id)
      WHEN r.platform_ending='capture_shortfall' AND final.command_id IS NOT NULL AND final.freeze_revision IS NOT NULL
        THEN jsonb_build_object('kind','capture_shortfall','commandId',final.command_id,'freezeRevision',final.freeze_revision)
      ELSE jsonb_build_object('kind','recorded_restoration') END AS provenance
  FROM usage_reservations u JOIN rounds r ON r.id=u.round_id
  LEFT JOIN LATERAL (SELECT id FROM round_incidents i WHERE i.round_id=u.round_id
    AND i.ended_at IS NOT NULL AND i.resumed_at IS NULL ORDER BY i.ended_at DESC LIMIT 1) incident ON true
  LEFT JOIN round_finalizations final ON final.round_id=u.round_id
  CROSS JOIN LATERAL (
    SELECT CASE WHEN count(*)=0 OR count(*) FILTER(WHERE a.configuration_snapshot->>'providerOutcome' IN ('received','failed'))<>count(*) THEN 'unknown'
      WHEN count(*) FILTER(WHERE a.configuration_snapshot->>'providerOutcome'='received')>0 THEN 'delivered'
      ELSE 'definite_failure' END AS value
    FROM agent_runs a JOIN round_participants p ON p.id=a.round_participant_id
    WHERE p.round_id=u.round_id AND p.role IN ('affirmative','negative') AND a.requests>0
  ) outcome
  WHERE u.kind='ai_round' AND u.source->>'kind'='beta'
), repaired AS (
  SELECT id, CASE
    -- A refund is proof of prior relief, not proof of provider failure.
    WHEN state->>'kind'='refunded' AND outcome<>'definite_failure'
      THEN jsonb_build_object('kind','credited','countedAt',state->>'countedAt',
        'creditedAt',state->>'refundedAt','provenance',provenance,'providerOutcome',outcome)
    -- A served call in a live Round cannot settle the aggregate of future calls.
    WHEN state->>'kind'='delivered' AND status NOT IN ('completed','abandoned')
      THEN jsonb_set(state,'{kind}','"unknown"'::jsonb)
    WHEN state->>'kind'='credited' AND outcome='unknown' AND state->>'providerOutcome'<>'unknown'
      THEN jsonb_set(state,'{providerOutcome}','"unknown"'::jsonb)
    ELSE state END AS state
  FROM facts
)
UPDATE usage_reservations u SET state=repaired.state FROM repaired
WHERE u.id=repaired.id AND u.state IS DISTINCT FROM repaired.state;

--> statement-breakpoint
SET CONSTRAINTS ALL IMMEDIATE;
--> statement-breakpoint
UPDATE usage_reservations SET state=state||'{"countBasis":"dispatch_record"}'::jsonb
WHERE state ? 'countedAt' AND NOT state ? 'countBasis';

--> statement-breakpoint
SET CONSTRAINTS ALL IMMEDIATE;
--> statement-breakpoint
-- Historical casual judge cohort: exact original sponsor/period/ID recognition.
WITH observed AS MATERIALIZED (SELECT clock_timestamp() AS now), cohort AS (
  SELECT r.*, a.id AS sponsor,
    to_char(date_trunc('month',r.created_at AT TIME ZONE 'UTC'),'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS period_start,
    to_char(date_trunc('month',r.created_at AT TIME ZONE 'UTC')+interval '1 month','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS period_end,
    calls.total, calls.received, calls.failed, coalesce(calls.recognized_at,observed.now) AS recognized_at, observed.now AS observed_at,
    (r.status IN ('completed','abandoned') OR NOT EXISTS (
      SELECT 1 FROM round_participants p JOIN actors judge ON judge.id=p.actor_id
      LEFT JOIN round_judging_jobs j ON j.round_id=p.round_id AND j.judge_participant_id=p.id
      WHERE p.round_id=r.id AND p.role='judge' AND judge.kind='bot'
        AND (j.status IS NULL OR j.status IN ('queued','leased'))
    )) AS terminal
  FROM rounds r JOIN actors a ON a.id=r.created_by_actor_id AND a.kind='human'
  JOIN users u ON u.id=a.user_id AND u.deleted_at IS NULL
  CROSS JOIN observed
  CROSS JOIN LATERAL (
    SELECT coalesce(sum(run.requests),0)::int AS total,
      count(*) FILTER(WHERE t.answered_at IS NOT NULL)::int AS received,
      count(*) FILTER(WHERE t.answered_at IS NULL AND t.category='provider_refused')::int AS failed,
      min(t.created_at) FILTER(WHERE t.created_at>=r.created_at AND t.created_at<=observed.now) AS recognized_at
    FROM round_participants p JOIN agent_runs run ON run.round_participant_id=p.id AND run.kind='judging' AND run.requests>0
    LEFT JOIN round_judging_attempts t ON t.agent_run_id=run.id
    WHERE p.round_id=r.id AND p.role='judge'
  ) calls
  WHERE r.competition_type='casual'
    AND EXISTS (SELECT 1 FROM round_participants p JOIN actors judge ON judge.id=p.actor_id
      WHERE p.round_id=r.id AND p.role='judge' AND judge.kind='bot')
    AND NOT EXISTS (SELECT 1 FROM usage_reservations prior WHERE prior.round_id=r.id AND prior.kind='casual_ai_judge')
)
INSERT INTO usage_reservations(id,actor_id,round_id,kind,source,state,reserved_at,binds_free_judge)
SELECT 'm'||left(encode(sha256(convert_to('casual_judge_usage:'||id||':'||sponsor,'UTF8')),'hex'),23),
  sponsor,id,'casual_ai_judge',jsonb_build_object('kind','beta','startsAt',period_start,'endsAt',period_end),
  CASE WHEN total=0 THEN
    CASE WHEN terminal THEN jsonb_build_object('kind','released','releasedAt',
      to_char(observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    ELSE jsonb_build_object('kind','reserved') END
  ELSE jsonb_build_object('kind',
    CASE WHEN NOT terminal OR received+failed<>total THEN 'unknown'
      WHEN received>0 THEN 'delivered' ELSE 'definite_failure' END,
    'countedAt',to_char(recognized_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'countBasis','historical_observation') END,
  created_at,false
FROM cohort
ON CONFLICT (actor_id,round_id,kind) DO NOTHING;


--> statement-breakpoint
SET CONSTRAINTS ALL IMMEDIATE;
--> statement-breakpoint
UPDATE round_analyses SET work = jsonb_build_object(
  'kind', CASE status WHEN 'succeeded' THEN 'retained' WHEN 'failed' THEN 'retired' ELSE 'unrequested' END,
  'historical', jsonb_build_object(
    'createdAt', created_at, 'completedAt', completed_at,
    'claimedAttempts', attempts, 'model', model,
    'inputTokens', input_tokens, 'outputTokens', output_tokens
  )
) || CASE status
  WHEN 'succeeded' THEN jsonb_build_object('report',report)
  WHEN 'failed' THEN jsonb_build_object('reason',CASE WHEN model='erased' THEN 'erased' ELSE 'failed' END)
  ELSE '{}'::jsonb END
WHERE work IS NULL;

--> statement-breakpoint
SET CONSTRAINTS ALL IMMEDIATE;

--> statement-breakpoint
ALTER TABLE "round_analyses" ALTER COLUMN "work" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "usage_reservations" ALTER COLUMN "source" SET NOT NULL, ALTER COLUMN "state" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "round_analyses" DROP COLUMN "status";
--> statement-breakpoint
ALTER TABLE "round_analyses" DROP COLUMN "attempts";
--> statement-breakpoint
ALTER TABLE "round_analyses" DROP COLUMN "lease_token_digest";
--> statement-breakpoint
ALTER TABLE "round_analyses" DROP COLUMN "lease_expires_at";
--> statement-breakpoint
ALTER TABLE "round_analyses" DROP COLUMN "model";
--> statement-breakpoint
ALTER TABLE "round_analyses" DROP COLUMN "report";
--> statement-breakpoint
ALTER TABLE "round_analyses" DROP COLUMN "input_tokens";
--> statement-breakpoint
ALTER TABLE "round_analyses" DROP COLUMN "output_tokens";
--> statement-breakpoint
ALTER TABLE "round_analyses" DROP COLUMN "completed_at";
--> statement-breakpoint
ALTER TABLE "usage_reservations" DROP COLUMN "counted_at";
--> statement-breakpoint
ALTER TABLE "usage_reservations" DROP COLUMN "refunded_at";
--> statement-breakpoint
CREATE UNIQUE INDEX "billing_customers_user_unique" ON "billing_customers" ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "billing_customers_vendor_unique" ON "billing_customers" ("mode","vendor_customer_id");
--> statement-breakpoint
CREATE INDEX "billing_customers_closed_idx" ON "billing_customers" ("closed_at","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "billing_payment_observations_invoice_unique" ON "billing_payment_observations" ("mode","vendor_invoice_id") WHERE "kind"='invoice';
--> statement-breakpoint
CREATE UNIQUE INDEX "billing_payment_observations_payment_unique" ON "billing_payment_observations" ("mode","vendor_invoice_payment_id") WHERE "kind"='payment';
--> statement-breakpoint
CREATE INDEX "billing_payment_observations_user_idx" ON "billing_payment_observations" ("user_id","id");
--> statement-breakpoint
CREATE INDEX "billing_payment_observations_route_idx" ON "billing_payment_observations" ("mode","vendor_customer_id","id");
--> statement-breakpoint
CREATE INDEX "billing_payment_observations_invoice_idx" ON "billing_payment_observations" ("mode","vendor_invoice_id","id");
--> statement-breakpoint
CREATE INDEX "billing_payment_observations_refund_idx" ON "billing_payment_observations" ("refund_action_id");
--> statement-breakpoint
CREATE INDEX "billing_purchases_user_idx" ON "billing_purchases" ("user_id","admitted_at","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "billing_purchases_pending_user_unique" ON "billing_purchases" ("user_id") WHERE "state"->>'kind' in ('admitted','creating','unknown','open');
--> statement-breakpoint
CREATE UNIQUE INDEX "billing_purchases_session_unique" ON "billing_purchases" (("state"->>'sessionId'));
--> statement-breakpoint
CREATE INDEX "billing_purchases_mode_discovery_idx" ON "billing_purchases" ("mode","id") WHERE "state"->>'kind' in ('creating','unknown','open','complete');
--> statement-breakpoint
CREATE UNIQUE INDEX "billing_refund_actions_charge_unique" ON "billing_refund_actions" ("mode","vendor_charge_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "billing_refund_actions_refund_unique" ON "billing_refund_actions" ("mode",("state"->>'refundId'));
--> statement-breakpoint
CREATE INDEX "billing_refund_actions_user_idx" ON "billing_refund_actions" ("user_id","id");
--> statement-breakpoint
CREATE INDEX "billing_refund_actions_mode_idx" ON "billing_refund_actions" ("mode","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "billing_subscriptions_vendor_unique" ON "billing_subscriptions" ("vendor_subscription_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "billing_subscriptions_current_user_unique" ON "billing_subscriptions" ("user_id") WHERE "current";
--> statement-breakpoint
CREATE INDEX "billing_subscriptions_user_idx" ON "billing_subscriptions" ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "billing_webhook_events_vendor_unique" ON "billing_webhook_events" ("mode","vendor_event_id");
--> statement-breakpoint
CREATE INDEX "billing_webhook_events_customer_idx" ON "billing_webhook_events" ("mode","vendor_customer_id");
--> statement-breakpoint
CREATE INDEX "billing_webhook_events_pending_idx" ON "billing_webhook_events" ("id") WHERE "notified_at" is null;
--> statement-breakpoint
CREATE INDEX "billing_webhook_events_retention_idx" ON "billing_webhook_events" ("received_at","id");
--> statement-breakpoint
CREATE INDEX "privacy_jobs_pending_vendor_due_idx" ON "privacy_jobs" ("vendor","retry_at","id") WHERE "status"='pending';
--> statement-breakpoint
CREATE INDEX "round_analyses_pending_idx" ON "round_analyses" (("work"->>'kind'),("work"->>'requestedAt'),"round_participant_id");
--> statement-breakpoint
CREATE INDEX "usage_reservations_actor_source_idx" ON "usage_reservations" ("actor_id","kind","source");
--> statement-breakpoint
CREATE UNIQUE INDEX "usage_reservations_free_binding_unique" ON "usage_reservations" ("actor_id") WHERE "binds_free_judge" and "binding_released_at" is null;
--> statement-breakpoint
ALTER TABLE "billing_customers" ADD CONSTRAINT "billing_customers_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "billing_payment_observations" ADD CONSTRAINT "billing_payment_observations_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "billing_payment_observations" ADD CONSTRAINT "billing_payment_observations_TJjQ35QJQTdb_fkey" FOREIGN KEY ("refund_action_id") REFERENCES "billing_refund_actions"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "billing_purchases" ADD CONSTRAINT "billing_purchases_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "billing_refund_actions" ADD CONSTRAINT "billing_refund_actions_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ADD CONSTRAINT "billing_subscriptions_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "account_entitlement_grants" ADD CONSTRAINT "account_entitlement_grants_validity_check" CHECK (
      ("source" = 'beta' and "starts_at" is null and "expires_at" is null)
      or ("source" = 'subscription' and "starts_at" is not null and "expires_at" is not null
        and isfinite("starts_at") and isfinite("expires_at") and "starts_at" < "expires_at")
    );
--> statement-breakpoint
ALTER TABLE "privacy_jobs" ADD CONSTRAINT "privacy_jobs_billing_cleanup_is_object" CHECK (jsonb_typeof("billing_cleanup") = 'object');
--> statement-breakpoint
ALTER TABLE "privacy_jobs" ADD CONSTRAINT "privacy_jobs_billing_cleanup_scope" CHECK ("billing_cleanup" is null or
      coalesce(("vendor"='stripe' and "billing_cleanup"->>'jobId'="id"
        and case "billing_cleanup"->>'kind'
          when 'acknowledged' then "status"='succeeded'
          when 'scanning' then "status"='pending'
          when 'deleting' then "status"='pending'
          else false end),false));
--> statement-breakpoint
ALTER TABLE "round_analyses" ADD CONSTRAINT "round_analyses_work_is_object" CHECK (jsonb_typeof("work") = 'object');
--> statement-breakpoint
ALTER TABLE "round_analyses" ADD CONSTRAINT "round_analyses_freeze_revision_check" CHECK ("freeze_revision" > 0);
--> statement-breakpoint
ALTER TABLE "round_analyses" ADD CONSTRAINT "round_analyses_work_kind_check" CHECK (coalesce("work"->>'kind' in ('unrequested','retained','retired','queued','leased','succeeded','failed','purged'),false));
--> statement-breakpoint
ALTER TABLE "round_analyses" ADD CONSTRAINT "round_analyses_history_check" CHECK (coalesce(("work"->'historical')='null'::jsonb or (
        jsonb_typeof(("work"->'historical'))='object'
        and ("work"->'historical') ?& array['createdAt','completedAt','claimedAttempts','model','inputTokens','outputTokens']
        and ("work"->'historical')-array['createdAt','completedAt','claimedAttempts','model','inputTokens','outputTokens']='{}'::jsonb
        and (("work"->'historical')->>'createdAt')::timestamptz="created_at"
        and isfinite((("work"->'historical')->>'createdAt')::timestamptz)
        and (("work"->'historical')->'completedAt'='null'::jsonb or (isfinite((("work"->'historical')->>'completedAt')::timestamptz) and (("work"->'historical')->>'completedAt')::timestamptz>="created_at"))
        and (jsonb_typeof(("work"->'historical')->'claimedAttempts')='number' and (("work"->'historical')->'claimedAttempts')::text ~ '^(0|[1-9][0-9]*)$' and (("work"->'historical')->'claimedAttempts')::numeric<=9007199254740991)
        and (jsonb_typeof(("work"->'historical')->'inputTokens')='number' and (("work"->'historical')->'inputTokens')::text ~ '^(0|[1-9][0-9]*)$' and (("work"->'historical')->'inputTokens')::numeric<=9007199254740991)
        and (jsonb_typeof(("work"->'historical')->'outputTokens')='number' and (("work"->'historical')->'outputTokens')::text ~ '^(0|[1-9][0-9]*)$' and (("work"->'historical')->'outputTokens')::numeric<=9007199254740991)
        and jsonb_typeof(("work"->'historical')->'model')='string' and length(("work"->'historical')->>'model')>0
      ),false));
--> statement-breakpoint
ALTER TABLE "round_analyses" ADD CONSTRAINT "round_analyses_request_check" CHECK (coalesce((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)='null'::jsonb or (jsonb_typeof((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end))='object'
    and (case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end) ?& array['requestId','requestedAt','deadlineAt','evidenceLines','claims','calls']
    and (case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)-array['requestId','requestedAt','deadlineAt','evidenceLines','claims','calls']='{}'::jsonb
    and jsonb_typeof((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'requestedAt')='string' and jsonb_typeof((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'deadlineAt')='string'
    and (case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->>'requestId' ~ '^[a-z][a-z0-9]{23}$'
    and isfinite(((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->>'requestedAt')::timestamptz)
    and ((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->>'deadlineAt')::timestamptz=((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->>'requestedAt')::timestamptz+interval '15 minutes'
    and (jsonb_typeof((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'evidenceLines')='number' and ((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'evidenceLines')::text ~ '^(0|[1-9][0-9]*)$' and ((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'evidenceLines')::numeric<=9007199254740991) and ((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->>'evidenceLines')::integer>0
    and (jsonb_typeof((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'claims')='number' and ((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'claims')::text ~ '^(0|[1-9][0-9]*)$' and ((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'claims')::numeric<=9007199254740991) and ((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->>'claims')::integer between 0 and 4
    and jsonb_typeof((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls')='array' and jsonb_array_length((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls')<=2
    and ((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->>'claims')::integer>=jsonb_array_length((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls')
    and (jsonb_array_length((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls')<1 or (jsonb_typeof(((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->0))='object'
    and ((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->0) ?& array['id','tokenDigest','model','dispatchedAt','outcome']
    and ((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->0)-array['id','tokenDigest','model','dispatchedAt','outcome']='{}'::jsonb
    and ((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->0)->>'id' ~ '^[a-z][a-z0-9]{23}$'
    and jsonb_typeof(((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->0)->'dispatchedAt')='string' and jsonb_typeof(((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->0)->'tokenDigest')='string'
    and ((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->0)->>'tokenDigest' ~ '^[a-f0-9]{64}$'
    and jsonb_typeof(((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->0)->'model')='string' and length(((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->0)->>'model')>0
    and (((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->0)->>'dispatchedAt')::timestamptz>=((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->>'requestedAt')::timestamptz
    and (((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->0)->>'dispatchedAt')::timestamptz<((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->>'deadlineAt')::timestamptz
    and case ((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->0)->'outcome'->>'kind'
      when 'unknown' then ((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->0)->'outcome'='{"kind":"unknown"}'::jsonb
      when 'definite_failure' then ((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->0)->'outcome'='{"kind":"definite_failure"}'::jsonb
      when 'received' then (((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->0)->'outcome')-array['kind','inputTokens','outputTokens']='{}'::jsonb and (jsonb_typeof(((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->0)->'outcome'->'inputTokens')='number' and (((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->0)->'outcome'->'inputTokens')::text ~ '^(0|[1-9][0-9]*)$' and (((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->0)->'outcome'->'inputTokens')::numeric<=9007199254740991) and (jsonb_typeof(((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->0)->'outcome'->'outputTokens')='number' and (((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->0)->'outcome'->'outputTokens')::text ~ '^(0|[1-9][0-9]*)$' and (((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->0)->'outcome'->'outputTokens')::numeric<=9007199254740991)
      else false end))
    and (jsonb_array_length((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls')<2 or (jsonb_typeof(((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->1))='object'
    and ((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->1) ?& array['id','tokenDigest','model','dispatchedAt','outcome']
    and ((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->1)-array['id','tokenDigest','model','dispatchedAt','outcome']='{}'::jsonb
    and ((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->1)->>'id' ~ '^[a-z][a-z0-9]{23}$'
    and jsonb_typeof(((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->1)->'dispatchedAt')='string' and jsonb_typeof(((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->1)->'tokenDigest')='string'
    and ((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->1)->>'tokenDigest' ~ '^[a-f0-9]{64}$'
    and jsonb_typeof(((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->1)->'model')='string' and length(((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->1)->>'model')>0
    and (((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->1)->>'dispatchedAt')::timestamptz>=((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->>'requestedAt')::timestamptz
    and (((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->1)->>'dispatchedAt')::timestamptz<((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->>'deadlineAt')::timestamptz
    and case ((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->1)->'outcome'->>'kind'
      when 'unknown' then ((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->1)->'outcome'='{"kind":"unknown"}'::jsonb
      when 'definite_failure' then ((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->1)->'outcome'='{"kind":"definite_failure"}'::jsonb
      when 'received' then (((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->1)->'outcome')-array['kind','inputTokens','outputTokens']='{}'::jsonb and (jsonb_typeof(((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->1)->'outcome'->'inputTokens')='number' and (((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->1)->'outcome'->'inputTokens')::text ~ '^(0|[1-9][0-9]*)$' and (((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->1)->'outcome'->'inputTokens')::numeric<=9007199254740991) and (jsonb_typeof(((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->1)->'outcome'->'outputTokens')='number' and (((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->1)->'outcome'->'outputTokens')::text ~ '^(0|[1-9][0-9]*)$' and (((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->1)->'outcome'->'outputTokens')::numeric<=9007199254740991)
      else false end
      and (case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->0->>'id'<>(case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->1->>'id'
      and (case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->0->>'tokenDigest'<>(case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls'->1->>'tokenDigest'))
        and (("work"->'historical')='null'::jsonb or (("work"->'historical')->'completedAt'='null'::jsonb and ((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->>'requestedAt')::timestamptz>="created_at"))
        and coalesce((("work"->'historical')->>'claimedAttempts')::integer,0)+jsonb_array_length((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls')<=2
        and (not ("work"->>'kind'='queued') or (((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->>'claims')::integer<4 and coalesce((("work"->'historical')->>'claimedAttempts')::integer,0)+jsonb_array_length((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->'calls')<2))
      ),false));
--> statement-breakpoint
ALTER TABLE "round_analyses" ADD CONSTRAINT "round_analyses_work_authority_check" CHECK (coalesce(case "work"->>'kind'
        when 'unrequested' then jsonb_typeof(("work"->'historical'))='object' and ("work"->'historical')->'completedAt'='null'::jsonb and "work"-array['kind','historical']='{}'::jsonb
        when 'retained' then jsonb_typeof(("work"->'historical'))='object' and ("work"->'historical')->'completedAt'<>'null'::jsonb and jsonb_typeof("work"->'report')='object' and "work"-array['kind','historical','report']='{}'::jsonb
        when 'retired' then jsonb_typeof(("work"->'historical'))='object' and ("work"->'historical')->'completedAt'<>'null'::jsonb and "work"->>'reason' in ('failed','erased') and "work"-array['kind','historical','reason']='{}'::jsonb
        when 'purged' then "work" ?& array['request','purgedAt','completedAt','historical'] and "work"-array['kind','request','purgedAt','completedAt','historical']='{}'::jsonb
          and (("work"->'historical')<>'null'::jsonb or (case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)<>'null'::jsonb)
          and isfinite(("work"->>'purgedAt')::timestamptz)
          and ("work"->>'purgedAt')::timestamptz>=coalesce(("work"->>'completedAt')::timestamptz,((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->>'requestedAt')::timestamptz,"created_at")
        else (case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)<>'null'::jsonb and "work" ? 'historical'
          and (("work"->>'kind'='leased') = ("work" ? 'lease'))
          and (("work"->>'kind'='succeeded') = ("work" ? 'report'))
          and (("work"->>'kind' in ('failed','succeeded')) = ("work" ? 'completedAt'))
          and (("work"->>'kind'='failed') = ("work" ? 'reason'))
          and (not ("work"->>'kind'='failed') or "work"->>'reason' in ('exhausted','authority','evidence','expired'))
          and (not ("work" ? 'completedAt') or (isfinite(("work"->>'completedAt')::timestamptz) and ("work"->>'completedAt')::timestamptz>=("work"->>'requestedAt')::timestamptz))
          and (not ("work"->>'kind'='succeeded') or (jsonb_typeof("work"->'report')='object' and ("work"->>'completedAt')::timestamptz<("work"->>'deadlineAt')::timestamptz and ("work"->'calls'->0->'outcome'->>'kind'='received' or "work"->'calls'->1->'outcome'->>'kind'='received')))
      end,false));
--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD CONSTRAINT "usage_reservations_reserved_at_check" CHECK (isfinite("reserved_at"));
--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD CONSTRAINT "usage_reservations_state_check" CHECK (coalesce(case "state"->>'kind'
      when 'reserved' then "state"='{"kind":"reserved"}'::jsonb
      when 'released' then "state"-array['kind','releasedAt']='{}'::jsonb
        and jsonb_typeof("state"->'releasedAt')='string'
        and isfinite(("state"->>'releasedAt')::timestamptz)
        and ("state"->>'releasedAt')::timestamptz>="reserved_at"
      when 'dispatched' then "state"-array['kind','countedAt','countBasis']='{}'::jsonb
      when 'unknown' then "state"-array['kind','countedAt','countBasis']='{}'::jsonb
      when 'delivered' then "state"-array['kind','countedAt','countBasis']='{}'::jsonb
      when 'definite_failure' then "state"-array['kind','countedAt','countBasis']='{}'::jsonb
      when 'refunded' then "state"-array['kind','countedAt','countBasis','refundedAt']='{}'::jsonb
        and jsonb_typeof("state"->'refundedAt')='string'
        and isfinite(("state"->>'refundedAt')::timestamptz)
        and ("state"->>'refundedAt')::timestamptz>=("state"->>'countedAt')::timestamptz
      when 'credited' then "kind"='ai_round'
        and "state"-array['kind','countedAt','countBasis','creditedAt','provenance','providerOutcome']='{}'::jsonb
        and jsonb_typeof("state"->'creditedAt')='string'
        and isfinite(("state"->>'creditedAt')::timestamptz)
        and ("state"->>'creditedAt')::timestamptz>=("state"->>'countedAt')::timestamptz
        and "state"->>'providerOutcome' in ('dispatched','unknown','delivered','definite_failure')
        and jsonb_typeof("state"->'provenance')='object'
        and case "state"->'provenance'->>'kind'
          when 'recorded_restoration' then "state"->'provenance'='{"kind":"recorded_restoration"}'::jsonb
          when 'recovery_bound' then ("state"->'provenance')-array['kind','incidentId']='{}'::jsonb
            and "state"->'provenance'->>'incidentId' ~ '^[a-z][a-z0-9]{23}$'
          when 'capture_shortfall' then ("state"->'provenance')-array['kind','commandId','freezeRevision']='{}'::jsonb
            and "state"->'provenance'->>'commandId' ~ '^[a-z][a-z0-9]{23}$'
            and jsonb_typeof("state"->'provenance'->'freezeRevision')='number'
            and "state"->'provenance'->>'freezeRevision' ~ '^[1-9][0-9]*$'
          else false end
      else false end, false));
--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD CONSTRAINT "usage_reservations_count_check" CHECK (coalesce(case
      when "state"->>'kind' in ('reserved','released') then not ("state" ?| array['countedAt','countBasis'])
      else "state"->>'countBasis' in ('dispatch_record','historical_observation')
        and jsonb_typeof("state"->'countedAt')='string'
        and isfinite(("state"->>'countedAt')::timestamptz)
        and ("state"->>'countedAt')::timestamptz >= "reserved_at"
        and ("state"->>'countedAt')::timestamptz <= clock_timestamp() end, false));
--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD CONSTRAINT "usage_reservations_source_check" CHECK (coalesce(case "source"->>'kind'
      when 'lifetime' then "source"='{"kind":"lifetime"}'::jsonb
      when 'beta' then "source"-array['kind','startsAt','endsAt']='{}'::jsonb
      when 'subscription' then "source"-array['kind','subscriptionId','startsAt','endsAt']='{}'::jsonb
        and "source"->>'subscriptionId' ~ '^[a-z][a-z0-9]{23}$'
      else false end, false) and coalesce(
        "source"->>'kind'='lifetime' or (
          jsonb_typeof("source"->'startsAt')='string' and jsonb_typeof("source"->'endsAt')='string'
          and isfinite(("source"->>'startsAt')::timestamptz) and isfinite(("source"->>'endsAt')::timestamptz)
          and ("source"->>'startsAt')::timestamptz < ("source"->>'endsAt')::timestamptz), false));
--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD CONSTRAINT "usage_reservations_binding_check" CHECK (
      (not "binds_free_judge" or ("kind"='ai_round' and "source"->>'kind'='lifetime')) and
      ("binding_released_at" is null or ("binds_free_judge" and "state"->>'kind'='released'
        and "binding_released_at">="reserved_at")));
--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD CONSTRAINT "usage_reservations_source_is_object" CHECK (jsonb_typeof("source") = 'object');
--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD CONSTRAINT "usage_reservations_state_is_object" CHECK (jsonb_typeof("state") = 'object');
--> statement-breakpoint
ALTER TABLE "account_entitlement_grants" DROP CONSTRAINT "account_entitlement_grants_source_check", ADD CONSTRAINT "account_entitlement_grants_source_check" CHECK ("source" in ('beta', 'subscription'));
--> statement-breakpoint
ALTER TABLE "privacy_jobs" DROP CONSTRAINT "privacy_jobs_vendor_valid", ADD CONSTRAINT "privacy_jobs_vendor_valid" CHECK ("vendor" in ('sentry', 'posthog', 'beehiiv', 'resend', 'object-storage', 'messaging-typing', 'stripe'));
--> statement-breakpoint
ALTER TABLE "round_analyses" ADD CONSTRAINT "round_analyses_lease_check" CHECK (coalesce("work"->>'kind'<>'leased' or (jsonb_typeof(("work"->'lease'))='object'
    and ("work"->'lease') ?& array['callId','tokenDigest','model','claimedAt','expiresAt']
    and ("work"->'lease')-array['callId','tokenDigest','model','claimedAt','expiresAt']='{}'::jsonb
    and jsonb_typeof(("work"->'lease')->'claimedAt')='string' and jsonb_typeof(("work"->'lease')->'expiresAt')='string' and jsonb_typeof(("work"->'lease')->'tokenDigest')='string'
    and ("work"->'lease')->>'callId' ~ '^[a-z][a-z0-9]{23}$' and ("work"->'lease')->>'tokenDigest' ~ '^[a-f0-9]{64}$'
    and jsonb_typeof(("work"->'lease')->'model')='string' and length(("work"->'lease')->>'model')>0
    and ((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->>'claims')::integer>0
    and (("work"->'lease')->>'claimedAt')::timestamptz>=((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->>'requestedAt')::timestamptz
    and (("work"->'lease')->>'expiresAt')::timestamptz>(("work"->'lease')->>'claimedAt')::timestamptz
    and (("work"->'lease')->>'expiresAt')::timestamptz<=(("work"->'lease')->>'claimedAt')::timestamptz+interval '3 minutes'
    and (("work"->'lease')->>'expiresAt')::timestamptz<=((case when "work"->>'kind'='purged' then "work"->'request' when "work" ? 'requestedAt' then "work"-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)->>'deadlineAt')::timestamptz),false));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_usage_attribution() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id,NEW.actor_id,NEW.round_id,NEW.kind,NEW.source,NEW.reserved_at,NEW.binds_free_judge)
    IS DISTINCT FROM (OLD.id,OLD.actor_id,OLD.round_id,OLD.kind,OLD.source,OLD.reserved_at,OLD.binds_free_judge) THEN
    RAISE EXCEPTION 'usage attribution is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.binding_released_at IS NOT NULL AND NEW.binding_released_at IS DISTINCT FROM OLD.binding_released_at THEN
    RAISE EXCEPTION 'released binding is terminal' USING ERRCODE='23514';
  END IF;
  IF OLD.state ? 'countedAt' AND (NEW.state->>'countedAt',NEW.state->>'countBasis')
    IS DISTINCT FROM (OLD.state->>'countedAt',OLD.state->>'countBasis') THEN
    RAISE EXCEPTION 'original usage count is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.state->>'kind' IN ('released','refunded') AND NEW.state IS DISTINCT FROM OLD.state THEN
    RAISE EXCEPTION 'released or refunded use is terminal' USING ERRCODE='23514';
  END IF;
  IF OLD.state->>'kind'='definite_failure' AND NEW.state IS DISTINCT FROM OLD.state
    AND NOT (OLD.kind='ai_round' AND NEW.state->>'kind'='credited' AND NEW.state->>'providerOutcome'='definite_failure') THEN
    RAISE EXCEPTION 'unrestored failure cannot invent relief or execution' USING ERRCODE='23514';
  END IF;
  IF OLD.state->>'kind'='credited' AND
    NEW.state-'providerOutcome' IS DISTINCT FROM OLD.state-'providerOutcome' THEN
    RAISE EXCEPTION 'original platform credit is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION guard_analysis_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  previous_request jsonb;
  next_request jsonb;
  old_call jsonb;
  next_call jsonb;
  previous_calls integer;
  next_calls integer;
  previous_claims integer;
  next_claims integer;
  ordinal integer;
BEGIN
  next_request := CASE WHEN NEW.work->>'kind'='purged' THEN NEW.work->'request'
    WHEN NEW.work ? 'requestedAt' THEN NEW.work-array['kind','historical','lease','report','reason','completedAt'] ELSE 'null'::jsonb END;
  IF TG_OP='INSERT' THEN
    IF NEW.work->>'kind' IS DISTINCT FROM 'queued' OR NEW.work->'historical' IS DISTINCT FROM 'null'::jsonb
      OR next_request->'claims' IS DISTINCT FROM '0'::jsonb OR next_request->'calls' IS DISTINCT FROM '[]'::jsonb
      OR (next_request->>'requestedAt')::timestamptz>clock_timestamp() THEN
      RAISE EXCEPTION 'analysis starts with a new uncounted request' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.round_id,NEW.round_participant_id,NEW.freeze_revision,NEW.created_at,NEW.work->'historical')
    IS DISTINCT FROM (OLD.round_id,OLD.round_participant_id,OLD.freeze_revision,OLD.created_at,OLD.work->'historical') THEN
    RAISE EXCEPTION 'analysis identity and historical observations are immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.work=OLD.work THEN RETURN NEW; END IF;
  previous_request := CASE WHEN OLD.work->>'kind'='purged' THEN OLD.work->'request'
    WHEN OLD.work ? 'requestedAt' THEN OLD.work-array['kind','historical','lease','report','reason','completedAt'] ELSE 'null'::jsonb END;
  IF OLD.work->>'kind' IN ('retained','retired','succeeded','failed','purged')
    AND NEW.work->>'kind' NOT IN (OLD.work->>'kind','purged') THEN
    RAISE EXCEPTION 'terminal analysis cannot reopen' USING ERRCODE='23514';
  END IF;
  IF OLD.work ? 'completedAt' AND NEW.work->'completedAt' IS DISTINCT FROM OLD.work->'completedAt' THEN
    RAISE EXCEPTION 'analysis completion is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.work ? 'purgedAt' AND NEW.work->'purgedAt' IS DISTINCT FROM OLD.work->'purgedAt' THEN
    RAISE EXCEPTION 'analysis purge is terminal' USING ERRCODE='23514';
  END IF;
  IF NEW.work->>'kind'<>'purged' AND (
    (OLD.work ? 'report' AND NEW.work->'report' IS DISTINCT FROM OLD.work->'report') OR
    (OLD.work ? 'reason' AND NEW.work->'reason' IS DISTINCT FROM OLD.work->'reason')) THEN
    RAISE EXCEPTION 'analysis terminal content cannot be replaced' USING ERRCODE='23514';
  END IF;
  IF previous_request='null'::jsonb THEN
    IF next_request<>'null'::jsonb AND (OLD.work->>'kind'<>'unrequested' OR NEW.work->>'kind'<>'queued'
      OR next_request->'claims' IS DISTINCT FROM '0'::jsonb OR next_request->'calls' IS DISTINCT FROM '[]'::jsonb
      OR (next_request->>'requestedAt')::timestamptz>clock_timestamp()) THEN
      RAISE EXCEPTION 'historical analysis requires a fresh uncounted request' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF next_request='null'::jsonb OR next_request-array['claims','calls'] IS DISTINCT FROM previous_request-array['claims','calls'] THEN
    RAISE EXCEPTION 'analysis request admission is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.work->>'kind'='succeeded' AND OLD.work->>'kind'<>'succeeded' THEN
    IF OLD.work->>'kind'<>'leased' OR (OLD.work->'lease'->>'expiresAt')::timestamptz<=clock_timestamp()
      OR (NEW.work->>'completedAt')::timestamptz>clock_timestamp()
      OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(next_request->'calls') c
        WHERE c->>'id'=OLD.work->'lease'->>'callId' AND c->'outcome'->>'kind'='received') THEN
      RAISE EXCEPTION 'analysis publication requires current received call authority' USING ERRCODE='23514';
    END IF;
  END IF;
  previous_calls := jsonb_array_length(previous_request->'calls');
  next_calls := jsonb_array_length(next_request->'calls');
  previous_claims := (previous_request->>'claims')::integer;
  next_claims := (next_request->>'claims')::integer;
  IF next_claims<previous_claims OR next_claims>previous_claims+1 OR next_calls<previous_calls OR next_calls>previous_calls+1 THEN
    RAISE EXCEPTION 'analysis work cannot reset or skip its budget' USING ERRCODE='23514';
  END IF;
  IF next_claims>previous_claims THEN
    IF NEW.work->>'kind'<>'leased' OR OLD.work->>'kind' NOT IN ('queued','leased') OR next_calls<>previous_calls
      OR (OLD.work->>'kind'='leased' AND (OLD.work->'lease'->>'expiresAt')::timestamptz>clock_timestamp())
      OR (NEW.work->'lease'->>'claimedAt')::timestamptz>clock_timestamp()
      OR (NEW.work->'lease'->>'expiresAt')::timestamptz<=clock_timestamp()
      OR NEW.work->'lease'->>'callId'=OLD.work->'lease'->>'callId'
      OR NEW.work->'lease'->>'tokenDigest'=OLD.work->'lease'->>'tokenDigest'
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(previous_request->'calls') c
        WHERE c->>'id'=NEW.work->'lease'->>'callId' OR c->>'tokenDigest'=NEW.work->'lease'->>'tokenDigest') THEN
      RAISE EXCEPTION 'analysis lease requires a new bounded claim' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.work->>'kind'='leased' AND NEW.work->'lease' IS DISTINCT FROM OLD.work->'lease' THEN
    RAISE EXCEPTION 'analysis lease cannot change without a claim' USING ERRCODE='23514';
  END IF;
  FOR ordinal IN 0..previous_calls-1 LOOP
    old_call := previous_request->'calls'->ordinal;
    next_call := next_request->'calls'->ordinal;
    IF next_call-'outcome' IS DISTINCT FROM old_call-'outcome'
      OR (old_call->'outcome'->>'kind'<>'unknown' AND next_call->'outcome' IS DISTINCT FROM old_call->'outcome') THEN
      RAISE EXCEPTION 'analysis dispatch and known provider outcome are immutable' USING ERRCODE='23514';
    END IF;
  END LOOP;
  IF next_calls>previous_calls THEN
    next_call := next_request->'calls'->previous_calls;
    IF OLD.work->>'kind'<>'leased' OR NEW.work->>'kind'<>'leased' OR next_claims<>previous_claims
      OR next_call->>'id' IS DISTINCT FROM OLD.work->'lease'->>'callId'
      OR next_call->>'tokenDigest' IS DISTINCT FROM OLD.work->'lease'->>'tokenDigest'
      OR next_call->>'model' IS DISTINCT FROM OLD.work->'lease'->>'model'
      OR next_call->'outcome' IS DISTINCT FROM '{"kind":"unknown"}'::jsonb
      OR (next_call->>'dispatchedAt')::timestamptz<(OLD.work->'lease'->>'claimedAt')::timestamptz
      OR (next_call->>'dispatchedAt')::timestamptz>=(OLD.work->'lease'->>'expiresAt')::timestamptz
      OR (next_call->>'dispatchedAt')::timestamptz>clock_timestamp()
      OR (OLD.work->'lease'->>'expiresAt')::timestamptz<=clock_timestamp() THEN
      RAISE EXCEPTION 'analysis dispatch requires the current lease' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
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
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.daisy_guard_stripe_cleanup() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $stripe_cleanup$
DECLARE
  checked timestamptz := clock_timestamp();
  prior jsonb;
  current jsonb;
  old_claim jsonb;
  new_claim jsonb;
  lane text;
  frame jsonb;
  detail jsonb;
  pattern text;
  item text;
  ids text[];
  lanes text[] := array['purchases','subscriptions','invoices','refunds','observations'];
  next_lane text;
  previous_frame jsonb;
  expected_frame jsonb;
  offset_index integer;
  observed_ids text[];
  observed_count integer;
  witness_state jsonb; witness_at timestamptz; witness_kind text;
  stamp_pattern text := '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$';
  invoice_pass jsonb; current_pass jsonb; old_pass jsonb; owner jsonb;
  comparison jsonb; pass_reads jsonb; pass_read jsonb; receipt jsonb;
  retained_state jsonb; stored_payment jsonb; stored_facts jsonb; read_evidence jsonb; read_facts jsonb;
  old_reads jsonb; old_read jsonb; read_offset integer;
  prior_debt jsonb; current_debt jsonb; expected_debt jsonb; debt_ids jsonb; identity_id text;
BEGIN
  IF TG_OP='UPDATE' AND (OLD.vendor='stripe' OR NEW.vendor='stripe')
    AND (NEW.subject_ref,NEW.vendor) IS DISTINCT FROM (OLD.subject_ref,OLD.vendor) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Stripe cleanup subject and vendor are immutable';
  END IF;
  IF NEW.vendor<>'stripe' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND NEW.id IS DISTINCT FROM OLD.id THEN
    IF NEW.id !~ '^[a-z0-9]{24}$' OR NEW.status<>'pending' OR NEW.attempts<>0 OR NEW.succeeded_at IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Stripe job rotation creates fresh pending execution only';
    END IF;
    -- Rotation retires execution authority, never the sole copy of an observed invoice identity.
    debt_ids:=coalesce(OLD.billing_cleanup->'invoiceDebt'->'ids','[]'::jsonb);
    IF OLD.billing_cleanup->>'kind'='scanning' AND OLD.billing_cleanup->'scans'->'invoices'->>'kind'='selected' THEN
      frame:=OLD.billing_cleanup->'scans'->'invoices';
      SELECT debt_ids||coalesce(jsonb_agg(identity ORDER BY position),'[]'::jsonb) INTO debt_ids
        FROM jsonb_array_elements(jsonb_build_array(frame->'id')||(frame->'rest')) WITH ORDINALITY incoming(identity,position)
        WHERE NOT EXISTS(SELECT 1 FROM public.billing_payment_observations observation
          JOIN public.billing_customers route ON route.user_id=observation.user_id
            AND route.mode=observation.mode AND route.vendor_customer_id=observation.vendor_customer_id AND route.closed_at IS NOT NULL
          WHERE observation.user_id=OLD.subject_ref AND observation.kind='invoice'
            AND observation.vendor_invoice_id=identity#>>'{}');
    END IF;
    SELECT coalesce(jsonb_agg(identity ORDER BY position),'[]'::jsonb) INTO debt_ids FROM
      (SELECT identity,min(position) AS position FROM jsonb_array_elements(debt_ids) WITH ORDINALITY incoming(identity,position) GROUP BY identity) unique_ids;
    NEW.billing_cleanup:=CASE WHEN jsonb_array_length(debt_ids)=0 THEN NULL ELSE
      jsonb_build_object('version',3,'kind','scanning','jobId',NEW.id,'retryAt',
        to_char(date_trunc('milliseconds',NEW.retry_at) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'claim',null,'turn','purchases','scans',
        '{"purchases":{"kind":"page","afterId":null},"subscriptions":{"kind":"page","afterId":null},"invoices":{"kind":"page","afterId":null},"refunds":{"kind":"page","afterId":null},"observations":{"kind":"page","afterId":null}}'::jsonb,
        'invoiceDebt',jsonb_build_object('kind','owed','ids',debt_ids,'next','identity')) END;
    RETURN NEW;
  END IF;
  IF TG_OP='UPDATE' AND NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Stripe job origin changes only with job rotation';
  END IF;
  current := NEW.billing_cleanup;
  prior := CASE WHEN TG_OP='UPDATE' THEN OLD.billing_cleanup ELSE NULL END;
  IF current IS NULL THEN
    IF prior IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Stripe authority clears only on job rotation';
    END IF;
    IF (TG_OP='INSERT' AND NEW.status<>'pending') OR
      (TG_OP='UPDATE' AND (NEW.status,NEW.attempts,NEW.retry_at,NEW.succeeded_at) IS DISTINCT FROM (OLD.status,OLD.attempts,OLD.retry_at,OLD.succeeded_at)) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Uninitialized Stripe execution cannot fabricate a queue outcome';
    END IF;
    RETURN NEW;
  END IF;
  IF current->>'jobId' IS DISTINCT FROM NEW.id OR NEW.id !~ '^[a-z0-9]{24}$'
    OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=NEW.subject_ref AND deleted_at IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Stripe cleanup requires its exact closed subject and job';
  END IF;
  IF current->>'kind'='acknowledged' THEN
    IF current-array['kind','outcome','jobId','checkedAt','nextAt']::text[]<>'{}'::jsonb
      OR coalesce(current->>'outcome' IN ('vendor-deleted','no-vendor-effects'),false)=false
      OR coalesce((current->>'checkedAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$',false)=false
      OR coalesce((current->>'nextAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$',false)=false
      OR (current->>'checkedAt')::timestamptz>checked
      OR (current->>'nextAt')::timestamptz<=(current->>'checkedAt')::timestamptz THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Invalid Stripe acknowledgement';
    END IF;
  ELSE
    IF current->'version' IS DISTINCT FROM '3'::jsonb OR coalesce(current->>'kind' IN ('scanning','deleting'),false)=false
      OR coalesce((current->>'retryAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$',false)=false
      OR (current->>'retryAt')::timestamptz<>date_trunc('milliseconds',NEW.retry_at)
      OR NOT current ? 'claim' THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Invalid Stripe execution time or phase';
    END IF;
    IF current->>'kind'='deleting' THEN
      IF current-array['version','kind','jobId','retryAt','claim']::text[]<>'{}'::jsonb THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Invalid Stripe deletion shape';
      END IF;
    ELSE
      IF current-array['version','kind','jobId','retryAt','claim','turn','scans','invoiceDebt']::text[]<>'{}'::jsonb
        OR coalesce(current->>'turn'=ANY(lanes),false)=false
        OR coalesce(jsonb_typeof(current->'scans')='object',false)=false
        OR NOT (current->'scans') ?& lanes OR (current->'scans')-lanes<>'{}'::jsonb THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Invalid Stripe scan lanes';
      END IF;
      current_debt:=current->'invoiceDebt';
      IF current_debt IS DISTINCT FROM '{"kind":"none"}'::jsonb THEN
        IF current_debt IS NULL OR current_debt->>'kind' IS DISTINCT FROM 'owed'
          OR NOT current_debt ?& array['kind','ids','next']
          OR current_debt-array['kind','ids','next']::text[]<>'{}'::jsonb
          OR current_debt->>'next' NOT IN ('identity','observations')
          OR jsonb_typeof(current_debt->'ids') IS DISTINCT FROM 'array'
          OR jsonb_array_length(current_debt->'ids')=0
          OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(current_debt->'ids') identity
            WHERE identity !~ '^in_[A-Za-z0-9_]+$' OR length(identity)>255)
          OR (SELECT count(DISTINCT identity) FROM jsonb_array_elements(current_debt->'ids') identity)<>jsonb_array_length(current_debt->'ids') THEN
          RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Strict unresolved invoice identity debt';
        END IF;
      END IF;
      FOREACH lane IN ARRAY lanes LOOP
        frame := current->'scans'->lane;
        pattern := CASE lane WHEN 'subscriptions' THEN '^sub_[A-Za-z0-9_]+$' WHEN 'invoices' THEN '^in_[A-Za-z0-9_]+$' ELSE '^[a-z0-9]{24}$' END;
        IF frame->>'kind'='complete' THEN
          IF frame<>'{"kind":"complete"}'::jsonb THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Invalid completed Stripe scan'; END IF;
        ELSIF frame->>'kind'='page' THEN
          IF frame-array['kind','afterId']::text[]<>'{}'::jsonb OR coalesce(frame->'afterId'='null'::jsonb OR (jsonb_typeof(frame->'afterId')='string' AND frame->>'afterId' ~ pattern AND length(frame->>'afterId')<=255),false)=false THEN
            RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Invalid Stripe page cursor';
          END IF;
        ELSIF frame->>'kind'='selected' THEN
          IF frame-array['kind','id','rest','lastId','more','detail']::text[]<>'{}'::jsonb
            OR coalesce(jsonb_typeof(frame->'rest')='array',false)=false
            OR coalesce(jsonb_typeof(frame->'more')='boolean',false)=false
            OR coalesce(jsonb_typeof(frame->'id')='string' AND frame->>'id' ~ pattern AND length(frame->>'id')<=255,false)=false THEN
            RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Invalid selected Stripe resource';
          END IF;
          IF jsonb_array_length(frame->'rest')>19 THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Stripe resource page is bounded'; END IF;
          ids := array[frame->>'id'];
          FOR item IN SELECT jsonb_array_elements_text(frame->'rest') LOOP
            IF item !~ pattern OR length(item)>255 OR item=ANY(ids) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Invalid Stripe page remainder'; END IF;
            ids := array_append(ids,item);
          END LOOP;
          IF frame->>'lastId' IS DISTINCT FROM ids[array_length(ids,1)] THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Stripe page end must preserve its selected remainder'; END IF;
          detail := frame->'detail';
          IF detail->>'kind'='invoice-payments' AND lane IN ('invoices','observations') THEN
            IF detail-array['kind','pass']::text[]<>'{}'::jsonb OR NOT detail ? 'pass' THEN
              RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid invoice pass detail';
            END IF;
            invoice_pass:=detail->'pass';
            IF invoice_pass<>'null'::jsonb THEN
              IF jsonb_typeof(invoice_pass)<>'object' OR NOT invoice_pass ?& array['id','jobId','beganAt','owner','phase','afterId','comparison']
                OR invoice_pass-array['id','jobId','beganAt','owner','phase','afterId','comparison','head']::text[]<>'{}'::jsonb
                OR coalesce(invoice_pass->>'id' ~ '^[a-z0-9]{24}$',false)=false OR invoice_pass->>'jobId' IS DISTINCT FROM NEW.id
                OR coalesce(invoice_pass->>'phase' IN ('retaining','verify-head','verify-invoice'),false)=false
                OR coalesce(invoice_pass->>'beganAt' ~ stamp_pattern,false)=false THEN
                RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid current invoice pass';
              END IF;
              owner:=invoice_pass->'owner';
              IF jsonb_typeof(owner)<>'object' OR NOT owner ?& array['userId','closedAt','mode','customerId','invoiceId','source','period']
                OR owner-array['userId','closedAt','mode','customerId','invoiceId','source','period']::text[]<>'{}'::jsonb
                OR owner->>'userId' IS DISTINCT FROM NEW.subject_ref OR coalesce(owner->>'closedAt' ~ stamp_pattern,false)=false
                OR coalesce(owner->>'mode' IN ('test','live'),false)=false
                OR coalesce(owner->>'customerId' ~ '^cus_[A-Za-z0-9_]{1,251}$',false)=false
                OR coalesce(owner->>'invoiceId' ~ '^in_[A-Za-z0-9_]{1,252}$',false)=false
                OR (lane='invoices' AND owner->>'invoiceId' IS DISTINCT FROM frame->>'id') THEN
                RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invoice pass owns one exact frozen subject and invoice';
              END IF;
              IF (owner->>'closedAt')::timestamptz IS DISTINCT FROM
                (SELECT date_trunc('milliseconds',deleted_at) FROM public.users WHERE id=NEW.subject_ref)
                OR (invoice_pass->>'beganAt')::timestamptz<(owner->>'closedAt')::timestamptz
                OR (invoice_pass->>'beganAt')::timestamptz>checked THEN
                RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invoice pass time follows local closure';
              END IF;
              IF NOT EXISTS(SELECT 1 FROM public.billing_payment_observations witness WHERE witness.user_id=NEW.subject_ref
                AND witness.kind='invoice' AND witness.mode=owner->>'mode' AND witness.vendor_customer_id=owner->>'customerId'
                AND witness.vendor_invoice_id=owner->>'invoiceId' AND (lane<>'observations' OR witness.id=frame->>'id')
                AND (witness.source=owner->'source' OR (owner->'source'->>'kind'='unresolved'
                  AND witness.source @> jsonb_strip_nulls((owner->'source')-'kind')))) THEN
                RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invoice pass requires its retained original owner';
              END IF;
              IF owner->'source'->>'kind'='unresolved' THEN
                IF (owner->'source')-array['kind','vendorSubscriptionId','priceId']::text[]<>'{}'::jsonb
                  OR NOT (owner->'source') ?& array['kind','vendorSubscriptionId','priceId']
                  OR coalesce(owner->'source'->'vendorSubscriptionId'='null'::jsonb OR owner->'source'->>'vendorSubscriptionId' ~ '^sub_[A-Za-z0-9_]{1,251}$',false)=false
                  OR coalesce(owner->'source'->'priceId'='null'::jsonb OR owner->'source'->>'priceId' ~ '^price_[A-Za-z0-9_]{1,249}$',false)=false THEN
                  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Strict unresolved original source';
                END IF;
              ELSIF owner->'source'->>'kind' IS DISTINCT FROM 'purchase' THEN
                RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid original invoice source';
              END IF;
              IF owner->'period'<>'null'::jsonb THEN
                IF jsonb_typeof(owner->'period')<>'object' OR NOT (owner->'period') ?& array['startsAt','endsAt']
                  OR (owner->'period')-array['startsAt','endsAt']::text[]<>'{}'::jsonb
                  OR coalesce(owner->'period'->>'startsAt' ~ stamp_pattern,false)=false
                  OR coalesce(owner->'period'->>'endsAt' ~ stamp_pattern,false)=false THEN
                  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid frozen invoice period';
                END IF;
                IF (owner->'period'->>'startsAt')::timestamptz>=(owner->'period'->>'endsAt')::timestamptz THEN
                  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Frozen invoice period is nonempty';
                END IF;
              END IF;
              comparison:=invoice_pass->'comparison';
              IF comparison->>'kind'='bounded' THEN
                IF comparison-array['kind','reads']::text[]<>'{}'::jsonb OR jsonb_typeof(comparison->'reads') IS DISTINCT FROM 'array'
                  OR jsonb_array_length(comparison->'reads')>20 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Bounded invoice comparison'; END IF;
                pass_reads:=comparison->'reads';
                IF invoice_pass->'afterId' IS DISTINCT FROM coalesce(pass_reads->-1->'invoicePaymentId','null'::jsonb) THEN
                  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invoice cursor follows exact retained comparison';
                END IF;
              ELSIF comparison->>'kind'='overflow' THEN
                IF comparison-array['kind','prefix','retainedCount']::text[]<>'{}'::jsonb
                  OR jsonb_typeof(comparison->'prefix') IS DISTINCT FROM 'array' OR jsonb_array_length(comparison->'prefix')<>20
                  OR coalesce(jsonb_typeof(comparison->'retainedCount')='number' AND comparison->>'retainedCount' ~ '^[0-9]+$',false)=false THEN
                  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Explicit bounded comparison overflow';
                END IF;
                IF (comparison->>'retainedCount')::numeric<21 OR (comparison->>'retainedCount')::numeric>9007199254740991
                  OR coalesce(invoice_pass->>'afterId' ~ '^inpay_[A-Za-z0-9_]{1,249}$',false)=false THEN
                  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Overflow retains count and actual cursor without completion';
                END IF;
                pass_reads:=comparison->'prefix';
              ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid invoice comparison'; END IF;
              ids:=array[]::text[];
              read_offset:=0;
              old_pass:=prior->'scans'->lane->'detail'->'pass';
              old_reads:=CASE WHEN old_pass->'comparison'->>'kind'='bounded' THEN old_pass->'comparison'->'reads' ELSE old_pass->'comparison'->'prefix' END;
              FOR pass_read IN SELECT value FROM jsonb_array_elements(pass_reads) LOOP
                IF jsonb_typeof(pass_read)<>'object' OR NOT pass_read ?& array['mode','customerId','invoiceId','invoicePaymentId','source','evidence']
                  OR pass_read-array['mode','customerId','invoiceId','invoicePaymentId','source','evidence']::text[]<>'{}'::jsonb
                  OR pass_read->'mode' IS DISTINCT FROM owner->'mode' OR pass_read->'customerId' IS DISTINCT FROM owner->'customerId'
                  OR pass_read->'invoiceId' IS DISTINCT FROM owner->'invoiceId' OR pass_read->'source' IS DISTINCT FROM owner->'source'
                  OR coalesce(pass_read->>'invoicePaymentId' ~ '^inpay_[A-Za-z0-9_]{1,249}$',false)=false
                  OR pass_read->>'invoicePaymentId'=ANY(ids) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact unique owned invoice membership'; END IF;
                ids:=array_append(ids,pass_read->>'invoicePaymentId');
                -- Stored prefix is historical comparison evidence, not authority over another lane's new facts.
                old_read:=old_reads->read_offset;
                read_offset:=read_offset+1;
                IF old_read IS NOT DISTINCT FROM pass_read
                  AND invoice_pass-array['phase','afterId','comparison','head']::text[] IS NOT DISTINCT FROM old_pass-array['phase','afterId','comparison','head']::text[]
                  AND NOT (invoice_pass->>'phase'='verify-invoice' AND old_pass->>'phase' IS DISTINCT FROM 'verify-invoice') THEN
                  CONTINUE;
                END IF;
                SELECT observation.state INTO retained_state FROM public.billing_payment_observations observation
                  WHERE observation.user_id=NEW.subject_ref AND observation.mode=owner->>'mode'
                  AND observation.vendor_customer_id=owner->>'customerId' AND observation.vendor_invoice_id=owner->>'invoiceId'
                  AND observation.kind='payment' AND observation.vendor_invoice_payment_id=pass_read->>'invoicePaymentId' AND observation.observed_at<=checked;
                IF NOT FOUND OR (retained_state->>'kind'='owed' AND retained_state->>'reason'='conflicting_evidence') THEN
                  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invoice comparison first retains every nonconflicting identity';
                END IF;
                stored_payment:=coalesce(retained_state->'payment',retained_state->'evidence'->'payment');
                stored_facts:=CASE WHEN stored_payment IS NOT NULL THEN jsonb_build_object(
                  'status','paid','paidAtSeconds',stored_payment->'paidAtSeconds','amountPaidMinor',stored_payment->'amountMinor',
                  'charge',jsonb_build_object('kind','observed','id',stored_payment->'chargeId','paid',true,
                    'capturedMinor',stored_payment->'amountMinor','currency',stored_payment->'currency'),'period',stored_payment->'period')
                  ELSE retained_state->'evidence'->'facts' END;
                IF owner->'period'<>'null'::jsonb AND stored_facts->'period' IS NOT NULL AND stored_facts->'period'<>'null'::jsonb
                  AND owner->'period' IS DISTINCT FROM stored_facts->'period' THEN
                  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Known original member period cannot hide behind a sparse read';
                END IF;
                read_evidence:=pass_read->'evidence';
                IF read_evidence->>'kind'='verified' THEN
                  IF read_evidence-array['kind','payment']::text[]<>'{}'::jsonb OR stored_payment IS NULL
                    OR read_evidence->'payment' IS DISTINCT FROM stored_payment
                    OR (owner->'period'<>'null'::jsonb AND owner->'period' IS DISTINCT FROM stored_payment->'period') THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Retained complete payment proof'; END IF;
                ELSIF read_evidence->>'kind' IN ('partial','chronology') THEN
                  IF read_evidence->>'kind'='chronology' THEN
                    IF read_evidence-array['kind','proof','facts']::text[]<>'{}'::jsonb
                      OR (read_evidence->'proof')-array['mode','customerId','invoiceId','invoicePaymentId','vendorSubscriptionId','priceId','status','paidAtSeconds']::text[]<>'{}'::jsonb
                      OR NOT (read_evidence->'proof') ?& array['mode','customerId','invoiceId','invoicePaymentId','vendorSubscriptionId','priceId','status','paidAtSeconds']
                      OR read_evidence->'proof'->>'status' IS DISTINCT FROM 'paid'
                      OR NOT coalesce((read_evidence->'proof'=retained_state->'evidence'->'proof'
                        OR (stored_payment IS NOT NULL AND stored_payment @> ((read_evidence->'proof')-'status'))),false) THEN
                      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Retained chronology proof';
                    END IF;
                  ELSIF read_evidence-array['kind','facts']::text[]<>'{}'::jsonb THEN
                    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid partial invoice evidence';
                  END IF;
                  read_facts:=read_evidence->'facts';
                  IF jsonb_typeof(read_facts) IS DISTINCT FROM 'object' OR NOT read_facts ?& array['status','paidAtSeconds','amountPaidMinor','charge','period']
                    OR read_facts-array['status','paidAtSeconds','amountPaidMinor','charge','period']::text[]<>'{}'::jsonb THEN
                    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Strict partial payment facts';
                  END IF;
                  FOREACH item IN ARRAY array['status','paidAtSeconds','amountPaidMinor','period'] LOOP
                    IF read_facts->item<>'null'::jsonb AND read_facts->item IS DISTINCT FROM stored_facts->item THEN
                      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Positive payment facts are retained before comparison';
                    END IF;
                  END LOOP;
                  IF read_facts->'charge' IS DISTINCT FROM '{"kind":"unresolved"}'::jsonb THEN
                    IF read_facts->'charge'->>'kind' IS DISTINCT FROM 'observed'
                      OR (read_facts->'charge')-array['kind','id','paid','capturedMinor','currency']::text[]<>'{}'::jsonb
                      OR NOT (read_facts->'charge') ?& array['kind','id','paid','capturedMinor','currency']
                      OR read_facts->'charge'->'id' IS DISTINCT FROM stored_facts->'charge'->'id' THEN
                      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Retained observed charge identity';
                    END IF;
                    FOREACH item IN ARRAY array['paid','capturedMinor','currency'] LOOP
                      IF read_facts->'charge'->item<>'null'::jsonb AND read_facts->'charge'->item IS DISTINCT FROM stored_facts->'charge'->item THEN
                        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Retained positive charge facts';
                      END IF;
                    END LOOP;
                  END IF;
                  IF owner->'period'<>'null'::jsonb AND read_facts->'period'<>'null'::jsonb AND owner->'period' IS DISTINCT FROM read_facts->'period' THEN
                    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invoice pass retains its frozen original period';
                  END IF;
                ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid normalized invoice evidence'; END IF;
              END LOOP;
              IF invoice_pass->>'phase'='verify-invoice' THEN
                receipt:=invoice_pass->'head';
                IF comparison->>'kind'<>'bounded' OR jsonb_array_length(pass_reads)=0
                  OR owner->'source'->>'kind'<>'purchase' OR owner->'period'='null'::jsonb
                  OR receipt-array['kind','passId','jobId','claimId','startedAt','observedAt','owner','request','hasMore','reads']::text[]<>'{}'::jsonb
                  OR NOT receipt ?& array['kind','passId','jobId','claimId','startedAt','observedAt','owner','request','hasMore','reads']
                  OR receipt->>'kind' IS DISTINCT FROM 'head' OR receipt->'owner' IS DISTINCT FROM owner
                  OR receipt->'passId' IS DISTINCT FROM invoice_pass->'id' OR receipt->>'jobId' IS DISTINCT FROM NEW.id
                  OR coalesce(receipt->>'claimId' ~ '^[a-z0-9]{24}$',false)=false
                  OR receipt->'request' IS DISTINCT FROM jsonb_build_object('invoiceId',owner->'invoiceId','limit',20)
                  OR receipt->'hasMore' IS DISTINCT FROM 'false'::jsonb OR receipt->'reads' IS DISTINCT FROM pass_reads
                  OR coalesce(receipt->>'startedAt' ~ stamp_pattern,false)=false OR coalesce(receipt->>'observedAt' ~ stamp_pattern,false)=false THEN
                  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Complete nonzero unfiltered single HEAD receipt';
                END IF;
                IF (receipt->>'startedAt')::timestamptz<(invoice_pass->>'beganAt')::timestamptz
                  OR (receipt->>'observedAt')::timestamptz<(receipt->>'startedAt')::timestamptz
                  OR (receipt->>'observedAt')::timestamptz>checked THEN
                  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invoice HEAD follows its current pass';
                END IF;
              ELSIF invoice_pass ? 'head' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='HEAD receipt belongs only to final invoice phase'; END IF;
            END IF;
          ELSIF detail IS DISTINCT FROM '{"kind":"resource"}'::jsonb OR lane='invoices' THEN
            RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid Stripe resource detail';
          END IF;
        ELSE RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Invalid Stripe scan phase'; END IF;
      END LOOP;
      IF NOT EXISTS(SELECT 1 FROM unnest(lanes) unfinished WHERE current->'scans'->unfinished->>'kind'<>'complete')
        OR (current->'scans'->(current->>'turn')->>'kind'='complete' AND NOT (current->>'turn'='observations' AND current_debt->>'kind'='owed')) THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Stripe work must select an unfinished lane';
      END IF;
    END IF;
  END IF;
  new_claim := current->'claim';
  IF current->>'kind'<>'acknowledged' AND new_claim<>'null'::jsonb THEN
    IF coalesce(jsonb_typeof(new_claim)='object',false)=false OR new_claim-array['id','claimedAt','expiresAt']::text[]<>'{}'::jsonb
      OR coalesce(new_claim->>'id' ~ '^[a-z0-9]{24}$',false)=false
      OR coalesce(new_claim->>'claimedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$',false)=false
      OR coalesce(new_claim->>'expiresAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$',false)=false
      OR (new_claim->>'claimedAt')::timestamptz>checked
      OR (new_claim->>'claimedAt')::timestamptz<(current->>'retryAt')::timestamptz
      OR (new_claim->>'expiresAt')::timestamptz<=(new_claim->>'claimedAt')::timestamptz
      OR (new_claim->>'expiresAt')::timestamptz>(new_claim->>'claimedAt')::timestamptz+interval '30 seconds' THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Invalid bounded Stripe claim';
    END IF;
  END IF;
  IF prior IS NULL THEN
    IF TG_OP<>'UPDATE' OR current->'invoiceDebt' IS DISTINCT FROM '{"kind":"none"}'::jsonb OR current->>'kind' IS DISTINCT FROM 'scanning' OR current->>'turn' IS DISTINCT FROM 'purchases'
      OR current->'scans' IS DISTINCT FROM '{"purchases":{"kind":"page","afterId":null},"subscriptions":{"kind":"page","afterId":null},"invoices":{"kind":"page","afterId":null},"refunds":{"kind":"page","afterId":null},"observations":{"kind":"page","afterId":null}}'::jsonb
      OR new_claim='null'::jsonb OR (new_claim->>'expiresAt')::timestamptz<=checked
      OR NEW.retry_at IS DISTINCT FROM OLD.retry_at OR NEW.attempts IS DISTINCT FROM OLD.attempts THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Stripe execution starts only with a current initial claim';
    END IF;
    RETURN NEW;
  END IF;
  IF current IS NOT DISTINCT FROM prior THEN
    IF (NEW.status,NEW.attempts,NEW.retry_at,NEW.succeeded_at) IS DISTINCT FROM (OLD.status,OLD.attempts,OLD.retry_at,OLD.succeeded_at) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Stripe queue outcome requires its execution transition'; END IF;
    RETURN NEW;
  END IF;
  old_claim := prior->'claim';
  IF prior->>'kind'='acknowledged' THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Acknowledged Stripe execution reopens only with a new job'; END IF;
  IF new_claim IS NOT NULL AND new_claim<>'null'::jsonb THEN
    IF current-'claim' IS DISTINCT FROM prior-'claim' OR new_claim IS NOT DISTINCT FROM old_claim
      OR (old_claim<>'null'::jsonb AND ((old_claim->>'expiresAt')::timestamptz>checked OR old_claim->>'id'=new_claim->>'id'))
      OR (new_claim->>'expiresAt')::timestamptz<=checked
      OR (NEW.status,NEW.attempts,NEW.retry_at) IS DISTINCT FROM (OLD.status,OLD.attempts,OLD.retry_at) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='A fresh Stripe claim cannot change progress or replace live authority';
    END IF;
    RETURN NEW;
  END IF;
  IF old_claim='null'::jsonb OR old_claim IS NULL OR (old_claim->>'expiresAt')::timestamptz<=checked THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Stripe progress requires its consumed current claim'; END IF;
  prior_debt:=coalesce(prior->'invoiceDebt','{"kind":"none"}'::jsonb);
  current_debt:=coalesce(current->'invoiceDebt','{"kind":"none"}'::jsonb);
  IF current->>'kind' IN ('acknowledged','deleting') AND prior_debt->>'kind'='owed' THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Unrouted positive invoice identities prevent completion or deletion';
  END IF;
  IF current->>'kind'='acknowledged' THEN
    IF EXISTS(SELECT 1 FROM public.billing_refund_actions action WHERE action.user_id=NEW.subject_ref
      AND NOT coalesce(action.state->>'kind'='known' AND action.state->>'status'='succeeded',false)) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Current original refund obligations prevent Stripe acknowledgement';
    END IF;
    IF (current->>'checkedAt')::timestamptz<(old_claim->>'claimedAt')::timestamptz OR NEW.succeeded_at IS DISTINCT FROM (current->>'checkedAt')::timestamptz
      OR NEW.attempts IS DISTINCT FROM OLD.attempts OR NEW.retry_at IS DISTINCT FROM OLD.retry_at THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Invalid Stripe completion accounting'; END IF;
    IF EXISTS(SELECT 1 FROM public.billing_payment_observations observation
      LEFT JOIN public.billing_refund_actions action ON action.id=observation.refund_action_id
      WHERE observation.user_id=NEW.subject_ref AND (observation.state->>'kind'='owed'
        OR (observation.state->>'kind'='refund-linked' AND NOT coalesce(action.state->>'kind'='known' AND action.state->>'status'='succeeded',false)))) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Current owed observations prevent Stripe acknowledgement';
    END IF;
    IF current->>'outcome'='vendor-deleted' AND prior->>'kind'<>'deleting' THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Stripe deletion requires completed scans'; END IF;
    IF current->>'outcome'='no-vendor-effects' AND (
      EXISTS(SELECT 1 FROM public.billing_customers WHERE user_id=NEW.subject_ref)
      OR EXISTS(SELECT 1 FROM public.billing_purchases WHERE user_id=NEW.subject_ref AND state->>'kind' NOT IN ('admitted','abandoned','expired'))
      OR EXISTS(SELECT 1 FROM public.billing_refund_actions WHERE user_id=NEW.subject_ref)
      OR EXISTS(SELECT 1 FROM public.billing_payment_observations WHERE user_id=NEW.subject_ref)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Missing customer alone does not prove absence of vendor effects'; END IF;
    RETURN NEW;
  END IF;
  -- Identity debt is retained independently of traversal authority, including unknown routing.
  expected_debt:=prior_debt;
  IF prior->>'kind'='scanning' AND prior->>'turn'='observations' THEN
    IF prior_debt->>'kind'='owed' AND (prior_debt->>'next'='identity'
      OR prior->'scans'->'observations'->>'kind'='complete') THEN
      identity_id:=prior_debt->'ids'->>0;
      IF NEW.attempts=OLD.attempts+1 THEN
        expected_debt:=jsonb_build_object('kind','owed','ids',((prior_debt->'ids')-0)||jsonb_build_array(identity_id),'next','observations');
      ELSE
        IF NOT EXISTS(SELECT 1 FROM public.billing_payment_observations observation
          JOIN public.users subject ON subject.id=observation.user_id
          WHERE observation.user_id=NEW.subject_ref AND observation.kind='invoice'
            AND observation.vendor_invoice_id=identity_id AND observation.closed_at=subject.deleted_at
            AND observation.state->>'kind'='owed' AND observation.observed_at<=checked) THEN
          RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact positive owned invoice routing precedes identity debt retirement';
        END IF;
        expected_debt:=CASE WHEN jsonb_array_length(prior_debt->'ids')=1 THEN '{"kind":"none"}'::jsonb
          ELSE jsonb_build_object('kind','owed','ids',(prior_debt->'ids')-0,'next','observations') END;
      END IF;
    ELSIF prior_debt->>'kind'='owed' THEN
      expected_debt:=jsonb_set(prior_debt,'{next}','"identity"'::jsonb);
    END IF;
  END IF;
  IF current_debt IS DISTINCT FROM expected_debt THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Stripe progress preserves exact unresolved invoice identities';
  END IF;
  IF identity_id IS NOT NULL AND NEW.attempts=OLD.attempts THEN
    IF current->>'kind'<>'scanning' OR current-array['claim','retryAt','turn','invoiceDebt','scans']::text[]
        IS DISTINCT FROM prior-array['claim','retryAt','turn','invoiceDebt','scans']::text[]
      OR NEW.retry_at<=checked OR NEW.retry_at>checked+interval '1 second' THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Retained invoice identity consumes exactly one bounded progress claim';
    END IF;
    next_lane:=NULL;
    FOR offset_index IN 1..cardinality(lanes) LOOP
      lane:=lanes[((array_position(lanes,prior->>'turn')-1+offset_index)%cardinality(lanes))+1];
      IF prior->'scans'->lane->>'kind'<>'complete' OR (lane='observations' AND expected_debt->>'kind'='owed') THEN
        next_lane:=lane; EXIT;
      END IF;
    END LOOP;
    IF next_lane IS NULL THEN
      IF current->>'turn'<>'purchases' OR current->'scans' IS DISTINCT FROM
        '{"purchases":{"kind":"page","afterId":null},"subscriptions":{"kind":"page","afterId":null},"invoices":{"kind":"page","afterId":null},"refunds":{"kind":"page","afterId":null},"observations":{"kind":"page","afterId":null}}'::jsonb THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Retained routing restarts discovery without resolving financial obligations';
      END IF;
    ELSIF current->>'turn' IS DISTINCT FROM next_lane OR current->'scans' IS DISTINCT FROM prior->'scans' THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invoice identity retention preserves frames and yields fairly';
    END IF;
    RETURN NEW;
  END IF;
  -- Every selected obligation survives before its execution cursor can move.
  IF prior->>'kind'='scanning' THEN
    previous_frame := prior->'scans'->(prior->>'turn');
    frame := current->'scans'->(prior->>'turn');
    IF prior->>'turn'='observations' AND previous_frame->>'kind'='page'
      AND (current->>'kind'='deleting' OR frame IS DISTINCT FROM previous_frame) THEN
      SELECT ARRAY(SELECT id FROM public.billing_payment_observations
        WHERE user_id=NEW.subject_ref AND (previous_frame->'afterId'='null'::jsonb OR id>previous_frame->>'afterId')
        ORDER BY id LIMIT 21) INTO observed_ids;
      observed_count := cardinality(observed_ids);
      IF observed_count=0 THEN
        IF current->>'kind'<>'deleting' AND frame IS DISTINCT FROM '{"kind":"complete"}'::jsonb
          AND NOT (current->>'turn'='purchases' AND current->'scans'='{"purchases":{"kind":"page","afterId":null},"subscriptions":{"kind":"page","afterId":null},"invoices":{"kind":"page","afterId":null},"refunds":{"kind":"page","afterId":null},"observations":{"kind":"page","afterId":null}}'::jsonb) THEN
          RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Observation exhaustion advances only its exact local keyset';
        END IF;
      ELSE
        expected_frame := jsonb_build_object('kind','selected','id',observed_ids[1],
          'rest',to_jsonb(observed_ids[2:least(observed_count,20)]),'lastId',observed_ids[least(observed_count,20)],
          'more',observed_count>20,'detail',jsonb_build_object('kind','resource'));
        IF current->>'kind'='deleting' OR frame IS DISTINCT FROM expected_frame THEN
          RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Observation page retains the exact bounded owned keyset';
        END IF;
      END IF;
    END IF;
    IF previous_frame->>'kind'='selected' AND (current->>'kind'='deleting' OR frame IS DISTINCT FROM previous_frame) THEN
      IF prior->>'turn'='refunds' AND NOT EXISTS(SELECT 1 FROM public.billing_refund_actions action
        WHERE action.user_id=NEW.subject_ref AND action.id=previous_frame->>'id'
          AND action.state->>'kind'='known' AND action.state->>'status'='succeeded') THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Selected original refund resolves only from current known success';
      END IF;
      IF (prior->>'turn'='invoices' OR prior->>'turn'='observations')
        AND NOT coalesce(frame->>'kind'='selected' AND frame->'id'=previous_frame->'id',false) THEN
        old_pass:=previous_frame->'detail'->'pass';
        SELECT observation.state,observation.observed_at,observation.kind INTO witness_state,witness_at,witness_kind
          FROM public.billing_payment_observations observation WHERE observation.user_id=NEW.subject_ref
            AND ((prior->>'turn'='invoices' AND observation.kind='invoice' AND observation.vendor_invoice_id=previous_frame->>'id')
              OR (prior->>'turn'='observations' AND observation.id=previous_frame->>'id'));
        IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact retained observation precedes selected progress'; END IF;
        IF witness_kind='invoice' AND witness_state->>'kind'<>'owed' THEN
          IF old_pass IS NULL OR old_pass->>'phase' IS DISTINCT FROM 'verify-invoice'
            OR witness_state->>'kind' IS DISTINCT FROM 'resolved' OR witness_state->>'basis' IS DISTINCT FROM 'enumeration_retained'
            OR witness_at<(old_claim->>'claimedAt')::timestamptz OR witness_at>checked
            OR witness_state->'paymentCount' IS DISTINCT FROM to_jsonb(jsonb_array_length(old_pass->'head'->'reads'))
            OR witness_state->'lastPaymentId' IS DISTINCT FROM old_pass->'afterId'
            OR old_pass->'comparison'->>'kind' IS DISTINCT FROM 'bounded'
            OR old_pass->'head'->'hasMore' IS DISTINCT FROM 'false'::jsonb
            OR old_pass->'head'->'reads' IS DISTINCT FROM old_pass->'comparison'->'reads' THEN
            RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Historical resolved enumeration is never fresh pass coverage';
          END IF;
          IF EXISTS(SELECT 1 FROM jsonb_array_elements(old_pass->'head'->'reads') member
            LEFT JOIN public.billing_payment_observations observation ON observation.user_id=NEW.subject_ref
              AND observation.kind='payment' AND observation.mode=old_pass->'owner'->>'mode'
              AND observation.vendor_customer_id=old_pass->'owner'->>'customerId'
              AND observation.vendor_invoice_id=old_pass->'owner'->>'invoiceId'
              AND observation.vendor_invoice_payment_id=member->>'invoicePaymentId'
            WHERE observation.id IS NULL OR (observation.state->>'kind'='owed' AND observation.state->>'reason'='conflicting_evidence')) THEN
            RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Fresh enumeration retains every current nonconflicting receipt member';
          END IF;
        END IF;
      END IF;
      IF prior->>'turn'='invoices' AND NOT EXISTS(SELECT 1 FROM public.billing_payment_observations
        WHERE user_id=NEW.subject_ref AND kind='invoice' AND vendor_invoice_id=previous_frame->>'id'
          AND observed_at<=checked) THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Invoice progress first retains its exact current obligation';
      END IF;
      IF prior->>'turn'='observations' AND NOT EXISTS(SELECT 1 FROM public.billing_payment_observations
        WHERE user_id=NEW.subject_ref AND id=previous_frame->>'id'
          AND observed_at<=checked) THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Observation progress first retains its exact current identity';
      END IF;

    END IF;
  END IF;
  IF current-array['claim','retryAt','turn','invoiceDebt']::text[] IS NOT DISTINCT FROM prior-array['claim','retryAt','turn','invoiceDebt']::text[] THEN
    IF NEW.attempts<>OLD.attempts+1 OR NEW.retry_at<=checked OR NEW.retry_at>checked+interval '1 hour' THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Stripe failure preserves work and uses bounded retry accounting'; END IF;
    IF prior->>'kind'='scanning' THEN
      FOR offset_index IN 1..cardinality(lanes) LOOP
        lane := lanes[((array_position(lanes,prior->>'turn')-1+offset_index)%cardinality(lanes))+1];
        IF current->'scans'->lane->>'kind'<>'complete' OR (lane='observations' AND current_debt->>'kind'='owed') THEN next_lane:=lane; EXIT; END IF;
      END LOOP;
      IF next_lane IS NULL OR current->>'turn' IS DISTINCT FROM next_lane THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Stripe failure yields fairly without dropping owed work';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  -- An exhausted pass with owed facts is a bounded new head traversal, never deletion relief.
  IF current->>'kind'='scanning' AND prior->>'kind'='scanning'
    AND current->>'turn'='purchases' AND current->'scans'='{"purchases":{"kind":"page","afterId":null},"subscriptions":{"kind":"page","afterId":null},"invoices":{"kind":"page","afterId":null},"refunds":{"kind":"page","afterId":null},"observations":{"kind":"page","afterId":null}}'::jsonb THEN
    IF NEW.attempts IS DISTINCT FROM OLD.attempts OR NEW.retry_at<=checked OR NEW.retry_at>checked+interval '1 second' THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Stripe traversal restart uses fixed progress scheduling';
    END IF;
    FOREACH lane IN ARRAY lanes LOOP
      IF lane<>prior->>'turn' AND prior->'scans'->lane->>'kind'<>'complete' THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Stripe restart cannot discard another selected obligation';
      END IF;
    END LOOP;
    previous_frame := prior->'scans'->(prior->>'turn');
    IF previous_frame->>'kind'='selected' AND (jsonb_array_length(previous_frame->'rest')<>0 OR (previous_frame->>'more')::boolean) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Stripe restart cannot skip its selected remainder';
    END IF;
    IF current_debt->>'kind'<>'owed'
      AND NOT EXISTS(SELECT 1 FROM public.billing_refund_actions action WHERE action.user_id=NEW.subject_ref
        AND NOT coalesce(action.state->>'kind'='known' AND action.state->>'status'='succeeded',false))
      AND NOT EXISTS(SELECT 1 FROM public.billing_payment_observations observation
      LEFT JOIN public.billing_refund_actions action ON action.id=observation.refund_action_id
      WHERE observation.user_id=NEW.subject_ref AND (observation.state->>'kind'='owed'
        OR (observation.state->>'kind'='refund-linked' AND NOT coalesce(action.state->>'kind'='known' AND action.state->>'status'='succeeded',false)))) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Stripe head restart requires current retained owed facts';
    END IF;
    RETURN NEW;
  END IF;
  IF prior->>'kind'<>'scanning' OR NEW.attempts IS DISTINCT FROM OLD.attempts OR NEW.retry_at<=checked OR NEW.retry_at>checked+interval '1 second' THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Durable Stripe progress has fixed due time independent of failure attempts'; END IF;
  IF current->>'kind'='deleting' THEN
    IF EXISTS(SELECT 1 FROM public.billing_refund_actions action WHERE action.user_id=NEW.subject_ref
      AND NOT coalesce(action.state->>'kind'='known' AND action.state->>'status'='succeeded',false)) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Current original refund obligations prevent customer deletion admission';
    END IF;
    IF EXISTS(SELECT 1 FROM public.billing_payment_observations observation LEFT JOIN public.billing_refund_actions action ON action.id=observation.refund_action_id
      WHERE observation.user_id=NEW.subject_ref AND (observation.state->>'kind'='owed' OR
        (observation.state->>'kind'='refund-linked' AND NOT coalesce(action.state->>'kind'='known' AND action.state->>'status'='succeeded',false)))) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Current financial obligations prevent customer deletion admission';
    END IF;
    FOREACH lane IN ARRAY lanes LOOP
      IF lane<>prior->>'turn' AND prior->'scans'->lane->>'kind'<>'complete' THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='All Stripe scan lanes precede deletion'; END IF;
    END LOOP;
    frame := prior->'scans'->(prior->>'turn');
    IF frame->>'kind'='selected' AND (jsonb_array_length(frame->'rest')<>0 OR (frame->>'more')::boolean) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Stripe deletion cannot skip page remainder'; END IF;
  ELSE
    previous_frame := prior->'scans'->(prior->>'turn');
    frame := current->'scans'->(prior->>'turn');
    IF frame IS NOT DISTINCT FROM previous_frame THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Stripe progress must advance durable work before yielding';
    END IF;
    IF previous_frame->>'kind'='page' THEN
      IF frame->>'kind' NOT IN ('selected','complete') THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Stripe page must persist selection before cursor advancement';
      END IF;
      IF prior->>'turn'='invoices' AND frame->>'kind'='selected' AND EXISTS(
        SELECT 1 FROM jsonb_array_elements(jsonb_build_array(frame->'id')||(frame->'rest')) identity
        WHERE NOT EXISTS(SELECT 1 FROM public.billing_payment_observations observation
          JOIN public.users subject ON subject.id=observation.user_id
          WHERE observation.user_id=NEW.subject_ref AND observation.kind='invoice'
            AND observation.vendor_invoice_id=identity#>>'{}'
            AND observation.closed_at=subject.deleted_at
            AND observation.state->>'kind'='owed' AND observation.observed_at<=checked)) THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Every observed invoice identity is retained owed before page admission';
      END IF;
      IF frame->>'kind'='selected' AND previous_frame->'afterId'<>'null'::jsonb AND
        (frame->'id'=previous_frame->'afterId' OR (frame->'rest') @> jsonb_build_array(previous_frame->'afterId')) THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Stripe page must advance beyond its prior cursor';
      END IF;
    ELSIF previous_frame->>'kind'='selected' THEN
      IF frame->>'kind'='selected' AND frame->'id'=previous_frame->'id' THEN
        current_pass:=frame->'detail'->'pass';
        old_pass:=previous_frame->'detail'->'pass';
        IF prior->>'turn' NOT IN ('invoices','observations') OR frame-'detail' IS DISTINCT FROM previous_frame-'detail'
          OR frame->'detail'->>'kind' IS DISTINCT FROM 'invoice-payments' OR current_pass IS NULL OR current_pass='null'::jsonb THEN
          RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Only a current invoice pass retains a selected resource';
        END IF;
        IF old_pass IS NULL OR old_pass='null'::jsonb THEN
          IF current_pass->>'phase'<>'retaining' OR current_pass->'afterId'<>'null'::jsonb
            OR current_pass->'comparison' IS DISTINCT FROM '{"kind":"bounded","reads":[]}'::jsonb
            OR (current_pass->>'beganAt')::timestamptz<(old_claim->>'claimedAt')::timestamptz
            OR NOT EXISTS(SELECT 1 FROM public.billing_payment_observations witness WHERE witness.user_id=NEW.subject_ref
              AND witness.kind='invoice' AND witness.mode=current_pass->'owner'->>'mode'
              AND witness.vendor_customer_id=current_pass->'owner'->>'customerId'
              AND witness.vendor_invoice_id=current_pass->'owner'->>'invoiceId' AND witness.state->>'kind'='owed' AND witness.state->>'reason'<>'conflicting_evidence') THEN
            RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Fresh invoice pass rearms only enumeration and starts at HEAD';
          END IF;
        ELSE
          IF current_pass-array['phase','afterId','comparison','head']::text[] IS DISTINCT FROM old_pass-array['phase','afterId','comparison','head']::text[] THEN
            RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invoice pass identity and frozen owner are immutable';
          END IF;
          IF old_pass->>'phase'='retaining' AND current_pass->>'phase' IN ('retaining','verify-head') THEN
            IF current_pass->'afterId' IS NOT DISTINCT FROM old_pass->'afterId' THEN
              IF current_pass->>'phase'<>'verify-head' OR old_pass->'afterId'='null'::jsonb
                OR current_pass->'comparison' IS DISTINCT FROM old_pass->'comparison' THEN
                RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Only nonempty exact exhaustion starts HEAD verification';
              END IF;
            ELSE
              IF old_pass->'comparison'->>'kind'='bounded' THEN
                IF jsonb_array_length(old_pass->'comparison'->'reads')<20 THEN
                  IF current_pass->'comparison'->>'kind'<>'bounded'
                    OR jsonb_array_length(current_pass->'comparison'->'reads')<>jsonb_array_length(old_pass->'comparison'->'reads')+1
                    OR (current_pass->'comparison'->'reads')-(jsonb_array_length(current_pass->'comparison'->'reads')-1)
                       IS DISTINCT FROM old_pass->'comparison'->'reads' THEN
                    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invoice progression appends exactly one retained read';
                  END IF;
                ELSIF current_pass->'comparison' IS DISTINCT FROM jsonb_build_object('kind','overflow','prefix',old_pass->'comparison'->'reads','retainedCount',21) THEN
                  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Comparison overflow preserves its complete prefix';
                END IF;
              ELSIF current_pass->'comparison' IS DISTINCT FROM jsonb_set(old_pass->'comparison','{retainedCount}',to_jsonb((old_pass->'comparison'->>'retainedCount')::numeric+1)) THEN
                RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Overflow advances count without evicting obligations';
              END IF;
              IF NOT EXISTS(SELECT 1 FROM public.billing_payment_observations observation WHERE observation.user_id=NEW.subject_ref
                AND observation.kind='payment' AND observation.mode=current_pass->'owner'->>'mode'
                AND observation.vendor_customer_id=current_pass->'owner'->>'customerId'
                AND observation.vendor_invoice_id=current_pass->'owner'->>'invoiceId'
                AND observation.vendor_invoice_payment_id=current_pass->>'afterId') THEN
                RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Cursor movement first retains its actual payment';
              END IF;
            END IF;
          ELSIF old_pass->>'phase'='verify-head' AND current_pass->>'phase'='verify-invoice' THEN
            IF current_pass->'afterId' IS DISTINCT FROM old_pass->'afterId' OR current_pass->'comparison' IS DISTINCT FROM old_pass->'comparison'
              OR current_pass->'head'->>'claimId' IS DISTINCT FROM old_claim->>'id'
              OR (current_pass->'head'->>'startedAt')::timestamptz<(old_claim->>'claimedAt')::timestamptz THEN
              RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Final HEAD belongs to the exact current pass and claim';
            END IF;
          ELSE RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid invoice pass phase transition'; END IF;
        END IF;
      ELSIF frame->>'kind'='selected' THEN
        expected_frame := previous_frame || jsonb_build_object('id',previous_frame->'rest'->0,
          'rest',(previous_frame->'rest')-0,'detail',CASE WHEN prior->>'turn'='invoices' THEN '{"kind":"invoice-payments","pass":null}'::jsonb ELSE '{"kind":"resource"}'::jsonb END);
        IF jsonb_array_length(previous_frame->'rest')=0 OR frame IS DISTINCT FROM expected_frame THEN
          RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Stripe selected progress consumes exactly one retained resource';
        END IF;
      ELSIF frame->>'kind'='page' THEN
        IF jsonb_array_length(previous_frame->'rest')<>0 OR NOT (previous_frame->>'more')::boolean
          OR frame->'afterId' IS DISTINCT FROM previous_frame->'lastId' THEN
          RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Stripe next page follows the exhausted selected remainder';
        END IF;
      ELSIF frame->>'kind'='complete' THEN
        IF jsonb_array_length(previous_frame->'rest')<>0 OR (previous_frame->>'more')::boolean THEN
          RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Stripe completion cannot skip selected page remainder';
        END IF;
      ELSE RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Invalid Stripe resource transition'; END IF;
    ELSE RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Completed Stripe lanes cannot advance'; END IF;
    FOREACH lane IN ARRAY lanes LOOP
      IF lane<>prior->>'turn' AND current->'scans'->lane IS DISTINCT FROM prior->'scans'->lane THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Stripe progress changes only its selected lane'; END IF;
    END LOOP;
    FOR offset_index IN 1..cardinality(lanes) LOOP
      lane := lanes[((array_position(lanes,prior->>'turn')-1+offset_index)%cardinality(lanes))+1];
      IF current->'scans'->lane->>'kind'<>'complete' OR (lane='observations' AND current_debt->>'kind'='owed') THEN next_lane:=lane; EXIT; END IF;
    END LOOP;
    IF next_lane IS NULL OR current->>'turn' IS DISTINCT FROM next_lane THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Stripe scan progress must yield fairly'; END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation OR numeric_value_out_of_range THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Malformed Stripe execution value';
END;
$stripe_cleanup$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.daisy_guard_billing_payment_observation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $payment_observation$
DECLARE
  checked timestamptz := clock_timestamp();
  closed timestamptz;
  old_evidence jsonb;
  new_evidence jsonb;
  old_facts jsonb;
  new_facts jsonb;
  proof jsonb;
  field text;
  current_job text; execution jsonb; selected jsonb; invoice_pass jsonb; receipt jsonb;
  member jsonb; member_state jsonb; member_action text; member_source jsonb; member_payment jsonb; member_ids text[]; member_period jsonb;
BEGIN
  SELECT deleted_at INTO closed FROM public.users WHERE id=NEW.user_id;
  IF closed IS NULL OR date_trunc('milliseconds',closed)<>NEW.closed_at
    OR NEW.observed_at>checked OR NEW.created_at<>date_trunc('milliseconds',NEW.created_at)
    OR NEW.observed_at<>date_trunc('milliseconds',NEW.observed_at) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Observation requires its original closed subject and actual recognition time';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.created_at<>NEW.observed_at OR NOT EXISTS(
      SELECT 1 FROM public.billing_customers WHERE user_id=NEW.user_id AND mode=NEW.mode AND vendor_customer_id=NEW.vendor_customer_id AND closed_at IS NOT NULL
      UNION ALL SELECT 1 FROM public.billing_purchases WHERE user_id=NEW.user_id AND mode=NEW.mode AND state->>'customerId'=NEW.vendor_customer_id
      UNION ALL SELECT 1 FROM public.billing_refund_actions WHERE user_id=NEW.user_id AND mode=NEW.mode AND vendor_customer_id=NEW.vendor_customer_id
      UNION ALL SELECT 1 FROM public.billing_payment_observations WHERE user_id=NEW.user_id AND mode=NEW.mode AND vendor_customer_id=NEW.vendor_customer_id
    ) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Observation requires positively owned retained routing';
    END IF;
  ELSE
    IF (NEW.id,NEW.user_id,NEW.mode,NEW.vendor_customer_id,NEW.vendor_invoice_id,NEW.kind,NEW.vendor_invoice_payment_id,NEW.closed_at,NEW.created_at)
      IS DISTINCT FROM (OLD.id,OLD.user_id,OLD.mode,OLD.vendor_customer_id,OLD.vendor_invoice_id,OLD.kind,OLD.vendor_invoice_payment_id,OLD.closed_at,OLD.created_at)
      OR NEW.observed_at<OLD.observed_at OR (OLD.refund_action_id IS NOT NULL AND NEW.refund_action_id IS DISTINCT FROM OLD.refund_action_id) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Observation identity and original money binding are immutable';
    END IF;
    IF OLD.source->>'kind'='purchase' AND NEW.source IS DISTINCT FROM OLD.source THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Original observation purchase is immutable';
    END IF;
    FOREACH field IN ARRAY array['vendorSubscriptionId','priceId'] LOOP
      IF OLD.source->field<>'null'::jsonb AND NEW.source->field IS DISTINCT FROM OLD.source->field THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Known original offer facts cannot be erased or replaced';
      END IF;
    END LOOP;
    IF OLD.state->>'kind'='owed' AND OLD.state->>'reason'='conflicting_evidence'
      AND (NEW.state->>'kind',NEW.state->>'reason') IS DISTINCT FROM ('owed','conflicting_evidence') THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Conflicting observation stays owed';
    END IF;
    IF NEW.kind='payment' THEN
      old_evidence := CASE WHEN OLD.state->>'kind'='refund-linked' THEN jsonb_build_object('kind','verified','payment',OLD.state->'payment') ELSE OLD.state->'evidence' END;
      new_evidence := CASE WHEN NEW.state->>'kind'='refund-linked' THEN jsonb_build_object('kind','verified','payment',NEW.state->'payment') ELSE NEW.state->'evidence' END;
      IF old_evidence->>'kind'='verified' AND new_evidence IS DISTINCT FROM old_evidence THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Verified original payment evidence cannot be erased or replaced';
      END IF;
      IF old_evidence->>'kind'='chronology' AND new_evidence->>'kind'='partial' THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Positive chronology cannot be forgotten';
      END IF;
      old_facts := old_evidence->'facts';
      IF old_evidence->>'kind'<>'verified' THEN
        IF new_evidence->>'kind'='verified' THEN
          proof := new_evidence->'payment';
          new_facts := jsonb_build_object('status','paid','paidAtSeconds',proof->'paidAtSeconds','amountPaidMinor',proof->'amountMinor','period',proof->'period',
            'charge',jsonb_build_object('kind','observed','id',proof->'chargeId','paid',true,'capturedMinor',proof->'amountMinor','currency',proof->'currency'));
        ELSE new_facts := new_evidence->'facts'; END IF;
        FOREACH field IN ARRAY array['paidAtSeconds','amountPaidMinor','period'] LOOP
          IF old_facts->field<>'null'::jsonb AND new_facts->field IS DISTINCT FROM old_facts->field THEN
            RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Known original financial facts cannot be erased or replaced';
          END IF;
        END LOOP;
        IF old_facts->>'status' IN ('paid','canceled') AND new_facts->'status' IS DISTINCT FROM old_facts->'status' THEN
          RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Terminal positive payment status cannot be erased';
        END IF;
        IF old_facts->'status'<>'null'::jsonb AND new_facts->'status'='null'::jsonb THEN
          RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Known payment status cannot be forgotten';
        END IF;
        IF old_facts->'charge'->>'kind'='observed' THEN
          IF new_facts->'charge'->>'kind' IS DISTINCT FROM 'observed' THEN
            RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Known charge cannot be forgotten';
          END IF;
          FOREACH field IN ARRAY array['id','paid','capturedMinor','currency'] LOOP
            IF old_facts->'charge'->field<>'null'::jsonb AND new_facts->'charge'->field IS DISTINCT FROM old_facts->'charge'->field THEN
              RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Known original charge facts cannot be erased or replaced';
            END IF;
          END LOOP;
        END IF;
      END IF;
    END IF;
  END IF;
  IF NEW.source->>'kind'='purchase' AND NOT EXISTS(
    SELECT 1 FROM public.billing_purchases WHERE id=NEW.source->>'purchaseId' AND user_id=NEW.user_id AND mode=NEW.mode
      AND price_id=NEW.source->>'priceId' AND date_trunc('milliseconds',admitted_at)=(NEW.source->>'admittedAt')::timestamptz
      AND state->>'kind'='complete' AND state->>'customerId'=NEW.vendor_customer_id AND state->>'subscriptionId'=NEW.source->>'vendorSubscriptionId'
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Observation source must match its original completed owned offer';
  END IF;
  IF NEW.refund_action_id IS NOT NULL THEN
    proof := CASE WHEN NEW.state->>'kind'='refund-linked' THEN NEW.state->'payment' ELSE NEW.state->'evidence'->'payment' END;
    IF NOT EXISTS(SELECT 1 FROM public.billing_refund_actions WHERE id=NEW.refund_action_id AND user_id=NEW.user_id AND mode=NEW.mode
      AND vendor_customer_id=NEW.vendor_customer_id AND vendor_invoice_id=NEW.vendor_invoice_id AND vendor_subscription_id=NEW.source->>'vendorSubscriptionId'
      AND vendor_charge_id=proof->>'chargeId' AND amount_minor=(proof->>'amountMinor')::bigint AND currency=proof->>'currency'
      AND paid_at_seconds=(proof->>'paidAtSeconds')::bigint AND closed_at=NEW.closed_at
      AND period_starts_at=(proof->'period'->>'startsAt')::timestamptz AND period_ends_at=(proof->'period'->>'endsAt')::timestamptz) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Observation can link only its exact original-charge action';
    END IF;
  END IF;
  -- SQL fences persisted execution/membership. The actual subsequent vendor invoice read is
  -- an application producer assertion, validated by finishInvoice before this same transaction writes.
  IF NEW.kind='invoice' AND NEW.state->>'kind'='resolved'
    AND (TG_OP='INSERT' OR NEW.state IS DISTINCT FROM OLD.state) THEN
    IF TG_OP='INSERT' THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Fresh invoice witnesses must first be retained unresolved';
    END IF;
    SELECT deleted_at INTO closed FROM public.users WHERE id=NEW.user_id FOR UPDATE;
    IF closed IS NULL OR date_trunc('milliseconds',closed) IS DISTINCT FROM NEW.closed_at THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Enumeration classification retains its current closed subject';
    END IF;
    SELECT job.id,job.billing_cleanup INTO current_job,execution FROM public.privacy_jobs job
      WHERE job.subject_ref=NEW.user_id AND job.vendor='stripe' AND job.status='pending' FOR UPDATE;
    checked:=clock_timestamp();
    IF NOT FOUND OR execution->'version' IS DISTINCT FROM '3'::jsonb OR execution->>'kind' IS DISTINCT FROM 'scanning'
      OR coalesce(execution->>'turn' IN ('invoices','observations'),false)=false OR execution->>'jobId' IS DISTINCT FROM current_job
      OR execution->'claim' IS NULL OR execution->'claim'='null'::jsonb THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Fresh enumeration requires current pending pass execution';
    END IF;
    selected:=execution->'scans'->(execution->>'turn');
    invoice_pass:=selected->'detail'->'pass';
    IF selected->>'kind' IS DISTINCT FROM 'selected' OR selected->'detail'->>'kind' IS DISTINCT FROM 'invoice-payments'
      OR (execution->>'turn'='invoices' AND selected->>'id' IS DISTINCT FROM NEW.vendor_invoice_id)
      OR (execution->>'turn'='observations' AND selected->>'id' IS DISTINCT FROM NEW.id)
      OR invoice_pass->>'phase' IS DISTINCT FROM 'verify-invoice'
      OR invoice_pass->>'jobId' IS DISTINCT FROM current_job
      OR invoice_pass->'owner'->>'userId' IS DISTINCT FROM NEW.user_id
      OR (invoice_pass->'owner'->>'closedAt')::timestamptz IS DISTINCT FROM NEW.closed_at
      OR invoice_pass->'owner'->>'mode' IS DISTINCT FROM NEW.mode
      OR invoice_pass->'owner'->>'customerId' IS DISTINCT FROM NEW.vendor_customer_id
      OR invoice_pass->'owner'->>'invoiceId' IS DISTINCT FROM NEW.vendor_invoice_id
      OR invoice_pass->'owner'->'source' IS DISTINCT FROM NEW.source
      OR invoice_pass->'owner'->'source'->>'kind' IS DISTINCT FROM 'purchase'
      OR invoice_pass->'owner'->'period' IS NULL OR invoice_pass->'owner'->'period'='null'::jsonb THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Enumeration classification owns its exact frozen invoice witness';
    END IF;
    IF (execution->'claim'->>'claimedAt')::timestamptz>checked
      OR (execution->'claim'->>'expiresAt')::timestamptz<=checked
      OR NEW.observed_at<(execution->'claim'->>'claimedAt')::timestamptz OR NEW.observed_at>checked THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Enumeration classification consumes current post-wait claim authority';
    END IF;
    receipt:=invoice_pass->'head';
    IF invoice_pass->'comparison'->>'kind' IS DISTINCT FROM 'bounded'
      OR receipt->>'kind' IS DISTINCT FROM 'head' OR receipt->'hasMore' IS DISTINCT FROM 'false'::jsonb
      OR receipt->'passId' IS DISTINCT FROM invoice_pass->'id' OR receipt->>'jobId' IS DISTINCT FROM current_job
      OR receipt->'owner' IS DISTINCT FROM invoice_pass->'owner'
      OR receipt->'request' IS DISTINCT FROM jsonb_build_object('invoiceId',NEW.vendor_invoice_id,'limit',20)
      OR receipt->'reads' IS DISTINCT FROM invoice_pass->'comparison'->'reads'
      OR jsonb_typeof(receipt->'reads') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Enumeration requires its persisted complete unfiltered HEAD';
    END IF;
    IF jsonb_array_length(receipt->'reads')<1 OR jsonb_array_length(receipt->'reads')>20
      OR NEW.state->'paymentCount' IS DISTINCT FROM to_jsonb(jsonb_array_length(receipt->'reads'))
      OR NEW.state->'lastPaymentId' IS DISTINCT FROM invoice_pass->'afterId'
      OR NEW.state->'lastPaymentId' IS DISTINCT FROM receipt->'reads'->-1->'invoicePaymentId'
      OR (receipt->>'observedAt')::timestamptz>NEW.observed_at THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Enumeration compares the whole nonzero bounded membership';
    END IF;
    member_ids:=array[]::text[];
    FOR member IN SELECT value FROM jsonb_array_elements(receipt->'reads') LOOP
      IF member->>'invoicePaymentId'=ANY(member_ids) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Enumeration member identities are unique'; END IF;
      member_ids:=array_append(member_ids,member->>'invoicePaymentId');
      SELECT observation.state,observation.refund_action_id,observation.source
        INTO member_state,member_action,member_source FROM public.billing_payment_observations observation
        WHERE observation.user_id=NEW.user_id AND observation.mode=NEW.mode
          AND observation.vendor_customer_id=NEW.vendor_customer_id AND observation.vendor_invoice_id=NEW.vendor_invoice_id
          AND observation.kind='payment' AND observation.vendor_invoice_payment_id=member->>'invoicePaymentId' FOR UPDATE;
      IF NOT FOUND OR member_source IS DISTINCT FROM invoice_pass->'owner'->'source'
        OR (member_state->>'kind'='owed' AND member_state->>'reason'='conflicting_evidence') THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Current exact member decisions must be retained without contradiction';
      END IF;
      member_period:=coalesce(member_state->'payment'->'period',member_state->'evidence'->'payment'->'period',member_state->'evidence'->'facts'->'period');
      IF member_period IS NOT NULL AND member_period<>'null'::jsonb AND member_period IS DISTINCT FROM invoice_pass->'owner'->'period' THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Enumeration preserves known original member periods';
      END IF;
      -- Owed/unknown payments and pending/failed actions remain independently owed: this is not settlement.
      IF member_action IS NOT NULL THEN
        member_payment:=coalesce(member_state->'payment',member_state->'evidence'->'payment');
        IF NOT EXISTS(SELECT 1 FROM public.billing_refund_actions action WHERE action.id=member_action AND action.user_id=NEW.user_id
          AND action.mode=NEW.mode AND action.vendor_customer_id=NEW.vendor_customer_id AND action.vendor_invoice_id=NEW.vendor_invoice_id
          AND action.vendor_subscription_id=NEW.source->>'vendorSubscriptionId'
          AND action.vendor_charge_id=member_payment->>'chargeId' AND action.amount_minor=(member_payment->>'amountMinor')::bigint
          AND action.currency=member_payment->>'currency' AND action.paid_at_seconds=(member_payment->>'paidAtSeconds')::bigint
          AND action.closed_at=NEW.closed_at AND action.period_starts_at=(member_payment->'period'->>'startsAt')::timestamptz
          AND action.period_ends_at=(member_payment->'period'->>'endsAt')::timestamptz) THEN
          RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Enumeration preserves each current original action binding';
        END IF;
      END IF;
    END LOOP;
    checked:=clock_timestamp();
    IF (execution->'claim'->>'expiresAt')::timestamptz<=checked THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Enumeration claim remains current after all member waits';
    END IF;
  END IF;
  IF NEW.kind='invoice' AND NEW.state->>'kind'='resolved' THEN
    IF NOT EXISTS(SELECT 1 FROM public.billing_payment_observations WHERE user_id=NEW.user_id AND mode=NEW.mode
        AND vendor_customer_id=NEW.vendor_customer_id AND vendor_invoice_id=NEW.vendor_invoice_id AND kind='payment'
        AND vendor_invoice_payment_id=NEW.state->>'lastPaymentId') THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Invoice coverage requires its positively retained payment identities';
    END IF;
  END IF;
  RETURN NEW;
END;
$payment_observation$;
--> statement-breakpoint
CREATE TRIGGER usage_attribution_immutable BEFORE UPDATE ON usage_reservations
FOR EACH ROW EXECUTE FUNCTION guard_usage_attribution();
--> statement-breakpoint
CREATE TRIGGER analysis_identity_immutable BEFORE INSERT OR UPDATE ON round_analyses
FOR EACH ROW EXECUTE FUNCTION guard_analysis_identity();
--> statement-breakpoint
CREATE TRIGGER billing_customer_identity BEFORE UPDATE ON public.billing_customers
FOR EACH ROW EXECUTE FUNCTION public.daisy_guard_billing_customer();
--> statement-breakpoint
CREATE TRIGGER billing_subscription_identity BEFORE UPDATE ON public.billing_subscriptions
FOR EACH ROW EXECUTE FUNCTION public.daisy_guard_billing_subscription();
--> statement-breakpoint
CREATE TRIGGER billing_receipt_identity BEFORE UPDATE ON public.billing_webhook_events
FOR EACH ROW EXECUTE FUNCTION public.daisy_guard_billing_receipt();
--> statement-breakpoint
CREATE TRIGGER billing_purchase_identity BEFORE INSERT OR UPDATE ON public.billing_purchases
FOR EACH ROW EXECUTE FUNCTION public.daisy_guard_billing_purchase();
--> statement-breakpoint
CREATE TRIGGER billing_refund_action_identity BEFORE INSERT OR UPDATE ON public.billing_refund_actions
FOR EACH ROW EXECUTE FUNCTION public.daisy_guard_billing_refund_action();
--> statement-breakpoint
CREATE TRIGGER stripe_cleanup_execution BEFORE INSERT OR UPDATE ON public.privacy_jobs
FOR EACH ROW EXECUTE FUNCTION public.daisy_guard_stripe_cleanup();
--> statement-breakpoint
CREATE TRIGGER daisy_billing_payment_observation_guard BEFORE INSERT OR UPDATE ON public.billing_payment_observations
FOR EACH ROW EXECUTE FUNCTION public.daisy_guard_billing_payment_observation();
--> statement-breakpoint
REVOKE DELETE ON round_analyses FROM daisy_web;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_guard_billing_customer(), public.daisy_guard_billing_subscription(), public.daisy_guard_billing_receipt() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON public.billing_customers, public.billing_webhook_events FROM PUBLIC, daisy_realtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_customers, public.billing_webhook_events TO daisy_web;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_guard_billing_purchase() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON public.billing_purchases FROM PUBLIC, daisy_realtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_purchases TO daisy_web;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_guard_billing_refund_action() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON public.billing_refund_actions FROM PUBLIC, daisy_realtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.billing_refund_actions TO daisy_web;
--> statement-breakpoint
REVOKE DELETE ON public.billing_refund_actions FROM daisy_web;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_guard_stripe_cleanup() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_guard_billing_payment_observation() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON public.billing_payment_observations FROM PUBLIC,daisy_realtime;
--> statement-breakpoint
GRANT SELECT,INSERT,UPDATE ON public.billing_payment_observations TO daisy_web;
--> statement-breakpoint
REVOKE DELETE ON public.billing_payment_observations FROM daisy_web;

