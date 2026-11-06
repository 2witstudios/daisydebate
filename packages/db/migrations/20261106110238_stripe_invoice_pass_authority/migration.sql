-- Retire predecessor execution authority without changing financial facts or historical acknowledgement.
CREATE OR REPLACE FUNCTION public.daisy_guard_stripe_cleanup() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $invoice_pass_transform$
DECLARE
  expected jsonb;
  scans jsonb;
  frame jsonb;
  lane text;
  lanes text[]:=array['purchases','subscriptions','invoices','refunds','observations'];
  heads jsonb:='{"purchases":{"kind":"page","afterId":null},"subscriptions":{"kind":"page","afterId":null},"invoices":{"kind":"page","afterId":null},"refunds":{"kind":"page","afterId":null},"observations":{"kind":"page","afterId":null}}'::jsonb;
  retry text;
  debt jsonb;
  debt_ids jsonb;
BEGIN
  IF TG_OP<>'UPDATE' OR OLD.vendor<>'stripe' OR OLD.status<>'pending'
    OR (to_jsonb(NEW)-'billing_cleanup') IS DISTINCT FROM (to_jsonb(OLD)-'billing_cleanup')
    OR coalesce(OLD.billing_cleanup ? 'version',false)
    OR coalesce(OLD.billing_cleanup->>'kind'='acknowledged',false) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Only exact pending predecessor execution transforms';
  END IF;
  retry:=CASE WHEN OLD.billing_cleanup IS NULL THEN
    to_char(date_trunc('milliseconds',OLD.retry_at) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ELSE OLD.billing_cleanup->>'retryAt' END;
  debt_ids:='[]'::jsonb;
  IF OLD.billing_cleanup->>'kind'='scanning' AND OLD.billing_cleanup->'scans'->'invoices'->>'kind'='selected' THEN
    frame:=OLD.billing_cleanup->'scans'->'invoices';
    SELECT coalesce(jsonb_agg(identity ORDER BY position),'[]'::jsonb) INTO debt_ids
      FROM jsonb_array_elements(jsonb_build_array(frame->'id')||(frame->'rest')) WITH ORDINALITY incoming(identity,position)
      WHERE NOT EXISTS(SELECT 1 FROM public.billing_payment_observations observation
        JOIN public.billing_customers route ON route.user_id=observation.user_id
          AND route.mode=observation.mode AND route.vendor_customer_id=observation.vendor_customer_id AND route.closed_at IS NOT NULL
        WHERE observation.user_id=OLD.subject_ref AND observation.kind='invoice'
          AND observation.vendor_invoice_id=identity#>>'{}');
  END IF;
  debt:=CASE WHEN jsonb_array_length(debt_ids)=0 THEN '{"kind":"none"}'::jsonb
    ELSE jsonb_build_object('kind','owed','ids',debt_ids,'next','identity') END;
  IF OLD.billing_cleanup IS NULL OR OLD.billing_cleanup->>'kind'='deleting' THEN
    expected:=jsonb_build_object('version',2,'kind','scanning','jobId',OLD.id,'retryAt',retry,'claim',null,'turn','purchases','scans',heads,'invoiceDebt',debt);
  ELSIF OLD.billing_cleanup->>'kind'='scanning' THEN
    scans:=OLD.billing_cleanup->'scans';
    FOREACH lane IN ARRAY lanes LOOP
      frame:=scans->lane;
      IF lane='invoices' AND frame->>'kind'='selected' THEN
        scans:=jsonb_set(scans,array[lane],jsonb_set(frame,'{detail}','{"kind":"invoice-payments","pass":null}'::jsonb));
      END IF;
    END LOOP;
    expected:=OLD.billing_cleanup || jsonb_build_object('version',2,'claim',null,'scans',scans,'invoiceDebt',debt);
  ELSE
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Unsupported predecessor execution remains untouched';
  END IF;
  IF NEW.billing_cleanup IS DISTINCT FROM expected THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Deterministic invoice pass transition preserves financial facts and queue accounting';
  END IF;
  RETURN NEW;
END;
$invoice_pass_transform$;
--> statement-breakpoint
WITH preserved AS MATERIALIZED(
  SELECT job.id, CASE WHEN job.billing_cleanup->>'kind'='scanning'
      AND job.billing_cleanup->'scans'->'invoices'->>'kind'='selected'
    THEN (SELECT coalesce(jsonb_agg(identity ORDER BY position),'[]'::jsonb)
      FROM jsonb_array_elements(jsonb_build_array(job.billing_cleanup->'scans'->'invoices'->'id')||
        (job.billing_cleanup->'scans'->'invoices'->'rest')) WITH ORDINALITY incoming(identity,position)
      WHERE NOT EXISTS(SELECT 1 FROM public.billing_payment_observations observation
        JOIN public.billing_customers route ON route.user_id=observation.user_id
          AND route.mode=observation.mode AND route.vendor_customer_id=observation.vendor_customer_id AND route.closed_at IS NOT NULL
        WHERE observation.user_id=job.subject_ref AND observation.kind='invoice'
          AND observation.vendor_invoice_id=identity#>>'{}'))
    ELSE '[]'::jsonb END AS ids
  FROM public.privacy_jobs job WHERE vendor='stripe' AND status='pending'
    AND NOT coalesce(billing_cleanup ? 'version',false)
    AND (billing_cleanup IS NULL OR billing_cleanup->>'kind' IN ('scanning','deleting'))
), debt AS MATERIALIZED(
  SELECT id,CASE WHEN jsonb_array_length(ids)=0 THEN '{"kind":"none"}'::jsonb
    ELSE jsonb_build_object('kind','owed','ids',ids,'next','identity') END AS value FROM preserved
)
UPDATE public.privacy_jobs job SET billing_cleanup=
  (CASE WHEN billing_cleanup IS NULL OR billing_cleanup->>'kind'='deleting' THEN
    jsonb_build_object('version',2,'kind','scanning','jobId',job.id,'retryAt',
      CASE WHEN billing_cleanup IS NULL THEN to_char(date_trunc('milliseconds',retry_at) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') ELSE billing_cleanup->>'retryAt' END,
      'claim',null,'turn','purchases','scans',
      '{"purchases":{"kind":"page","afterId":null},"subscriptions":{"kind":"page","afterId":null},"invoices":{"kind":"page","afterId":null},"refunds":{"kind":"page","afterId":null},"observations":{"kind":"page","afterId":null}}'::jsonb)
  ELSE jsonb_set(billing_cleanup || '{"version":2,"claim":null}'::jsonb,'{scans,invoices}',
    CASE WHEN billing_cleanup->'scans'->'invoices'->>'kind'='selected'
      THEN jsonb_set(billing_cleanup->'scans'->'invoices','{detail}','{"kind":"invoice-payments","pass":null}'::jsonb)
      ELSE billing_cleanup->'scans'->'invoices' END)
  END)||jsonb_build_object('invoiceDebt',debt.value)
FROM debt WHERE job.id=debt.id;
--> statement-breakpoint

-- Current bounded invoice pass execution; financial obligations remain independent.
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
      jsonb_build_object('version',2,'kind','scanning','jobId',NEW.id,'retryAt',
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
    IF current->'version' IS DISTINCT FROM '2'::jsonb OR coalesce(current->>'kind' IN ('scanning','deleting'),false)=false
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
    IF NOT FOUND OR execution->'version' IS DISTINCT FROM '2'::jsonb OR execution->>'kind' IS DISTINCT FROM 'scanning'
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
