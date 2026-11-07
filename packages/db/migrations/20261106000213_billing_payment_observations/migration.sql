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
CREATE UNIQUE INDEX "billing_payment_observations_invoice_unique" ON "billing_payment_observations" ("mode","vendor_invoice_id") WHERE "kind"='invoice';--> statement-breakpoint
CREATE UNIQUE INDEX "billing_payment_observations_payment_unique" ON "billing_payment_observations" ("mode","vendor_invoice_payment_id") WHERE "kind"='payment';--> statement-breakpoint
CREATE INDEX "billing_payment_observations_user_idx" ON "billing_payment_observations" ("user_id","id");--> statement-breakpoint
CREATE INDEX "billing_payment_observations_route_idx" ON "billing_payment_observations" ("mode","vendor_customer_id","id");--> statement-breakpoint
CREATE INDEX "billing_payment_observations_invoice_idx" ON "billing_payment_observations" ("mode","vendor_invoice_id","id");--> statement-breakpoint
CREATE INDEX "billing_payment_observations_refund_idx" ON "billing_payment_observations" ("refund_action_id");--> statement-breakpoint
ALTER TABLE "billing_payment_observations" ADD CONSTRAINT "billing_payment_observations_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "billing_payment_observations" ADD CONSTRAINT "billing_payment_observations_TJjQ35QJQTdb_fkey" FOREIGN KEY ("refund_action_id") REFERENCES "billing_refund_actions"("id") ON DELETE RESTRICT;
--> statement-breakpoint
-- Private retained observations never acquire execution authority or a money key.
CREATE FUNCTION public.daisy_guard_billing_payment_observation() RETURNS trigger
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
CREATE TRIGGER daisy_billing_payment_observation_guard BEFORE INSERT OR UPDATE ON public.billing_payment_observations
FOR EACH ROW EXECUTE FUNCTION public.daisy_guard_billing_payment_observation();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_guard_billing_payment_observation() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON public.billing_payment_observations FROM PUBLIC,daisy_realtime;
--> statement-breakpoint
GRANT SELECT,INSERT,UPDATE ON public.billing_payment_observations TO daisy_web;
--> statement-breakpoint
REVOKE DELETE ON public.billing_payment_observations FROM daisy_web;
