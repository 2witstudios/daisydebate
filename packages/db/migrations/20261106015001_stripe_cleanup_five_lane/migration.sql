-- Upgrade execution traversal without changing historical financial evidence or queue accounting.
LOCK TABLE public.privacy_jobs IN ACCESS EXCLUSIVE MODE;
CREATE OR REPLACE FUNCTION public.daisy_guard_stripe_cleanup() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $stripe_transform$
DECLARE expected jsonb; heads jsonb := '{"purchases":{"kind":"page","afterId":null},"subscriptions":{"kind":"page","afterId":null},"invoices":{"kind":"page","afterId":null},"refunds":{"kind":"page","afterId":null},"observations":{"kind":"page","afterId":null}}'::jsonb;
BEGIN
  IF TG_OP<>'UPDATE' OR OLD.vendor<>'stripe' OR OLD.status<>'pending'
    OR (to_jsonb(NEW)-'billing_cleanup') IS DISTINCT FROM (to_jsonb(OLD)-'billing_cleanup') THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Only exact Stripe execution transformation is admitted';
  END IF;
  IF OLD.billing_cleanup IS NULL OR OLD.billing_cleanup->>'kind'='deleting' THEN
    expected := jsonb_build_object('kind','scanning','jobId',OLD.id,'retryAt',to_char(OLD.retry_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'claim',null,'turn','purchases','scans',heads);
  ELSIF OLD.billing_cleanup->>'kind'='scanning' AND NOT (OLD.billing_cleanup->'scans') ? 'observations' THEN
    expected := OLD.billing_cleanup || jsonb_build_object('claim',null,'scans',(OLD.billing_cleanup->'scans') || jsonb_build_object('observations',heads->'observations'));
  ELSE
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Unsupported Stripe execution transformation';
  END IF;
  IF NEW.billing_cleanup IS DISTINCT FROM expected THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Stripe transform preserves exact identities, cursors, accounting and financial truth';
  END IF;
  RETURN NEW;
END $stripe_transform$;
UPDATE public.privacy_jobs SET billing_cleanup=CASE
  WHEN billing_cleanup IS NULL OR billing_cleanup->>'kind'='deleting' THEN
    jsonb_build_object('kind','scanning','jobId',id,'retryAt',to_char(retry_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'claim',null,'turn','purchases','scans','{"purchases":{"kind":"page","afterId":null},"subscriptions":{"kind":"page","afterId":null},"invoices":{"kind":"page","afterId":null},"refunds":{"kind":"page","afterId":null},"observations":{"kind":"page","afterId":null}}'::jsonb)
  ELSE billing_cleanup || jsonb_build_object('claim',null,'scans',(billing_cleanup->'scans') || jsonb_build_object('observations',jsonb_build_object('kind','page','afterId',null))) END
WHERE vendor='stripe' AND status='pending' AND
  (billing_cleanup IS NULL OR billing_cleanup->>'kind'='deleting' OR
    (billing_cleanup->>'kind'='scanning' AND NOT (billing_cleanup->'scans') ? 'observations'));
-- The temporary transform guard is replaced before COMMIT; no normal writer sees it.
-- Retained routing is not absence; current owed observations survive scan exhaustion and customer deletion.
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
    NEW.billing_cleanup := NULL;
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
    IF coalesce(current->>'kind' IN ('scanning','deleting'),false)=false
      OR coalesce((current->>'retryAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$',false)=false
      OR (current->>'retryAt')::timestamptz<>date_trunc('milliseconds',NEW.retry_at)
      OR NOT current ? 'claim' THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Invalid Stripe execution time or phase';
    END IF;
    IF current->>'kind'='deleting' THEN
      IF current-array['kind','jobId','retryAt','claim']::text[]<>'{}'::jsonb THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Invalid Stripe deletion shape';
      END IF;
    ELSE
      IF current-array['kind','jobId','retryAt','claim','turn','scans']::text[]<>'{}'::jsonb
        OR coalesce(current->>'turn'=ANY(lanes),false)=false
        OR coalesce(jsonb_typeof(current->'scans')='object',false)=false
        OR NOT (current->'scans') ?& lanes OR (current->'scans')-lanes<>'{}'::jsonb THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Invalid Stripe scan lanes';
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
          IF lane='invoices' THEN
            IF detail-array['kind','afterId']::text[]<>'{}'::jsonb OR detail->>'kind' IS DISTINCT FROM 'invoice-payments'
              OR coalesce(detail->'afterId'='null'::jsonb OR (jsonb_typeof(detail->'afterId')='string' AND detail->>'afterId' ~ '^inpay_[A-Za-z0-9_]+$' AND length(detail->>'afterId')<=255),false)=false THEN
              RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Invalid Stripe invoice payment cursor';
            END IF;
          ELSIF detail IS DISTINCT FROM '{"kind":"resource"}'::jsonb THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Invalid Stripe resource detail'; END IF;
        ELSE RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Invalid Stripe scan phase'; END IF;
      END LOOP;
      IF current->'scans'->(current->>'turn')->>'kind'='complete' THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Stripe work must select an unfinished lane'; END IF;
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
    IF TG_OP<>'UPDATE' OR current->>'kind' IS DISTINCT FROM 'scanning' OR current->>'turn' IS DISTINCT FROM 'purchases'
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
  IF current->>'kind'='acknowledged' THEN
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
      IF prior->>'turn'='invoices' AND NOT EXISTS(SELECT 1 FROM public.billing_payment_observations
        WHERE user_id=NEW.subject_ref AND kind='invoice' AND vendor_invoice_id=previous_frame->>'id'
          AND observed_at>=(old_claim->>'claimedAt')::timestamptz) THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Invoice progress first retains its exact current obligation';
      END IF;
      IF prior->>'turn'='observations' AND NOT EXISTS(SELECT 1 FROM public.billing_payment_observations
        WHERE user_id=NEW.subject_ref AND id=previous_frame->>'id'
          AND observed_at>=(old_claim->>'claimedAt')::timestamptz) THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Observation progress first retains its exact current identity';
      END IF;
      IF prior->>'turn'='invoices' AND frame->>'kind'='selected' AND frame->'id'=previous_frame->'id'
        AND frame->'detail' IS DISTINCT FROM previous_frame->'detail' AND NOT EXISTS(SELECT 1 FROM public.billing_payment_observations
          WHERE user_id=NEW.subject_ref AND kind='payment' AND vendor_invoice_id=previous_frame->>'id'
            AND vendor_invoice_payment_id=frame->'detail'->>'afterId'
            AND observed_at>=(old_claim->>'claimedAt')::timestamptz) THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Payment cursor progress first retains the exact payment identity';
      END IF;
    END IF;
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
    IF NOT EXISTS(SELECT 1 FROM public.billing_payment_observations observation
      LEFT JOIN public.billing_refund_actions action ON action.id=observation.refund_action_id
      WHERE observation.user_id=NEW.subject_ref AND (observation.state->>'kind'='owed'
        OR (observation.state->>'kind'='refund-linked' AND NOT coalesce(action.state->>'kind'='known' AND action.state->>'status'='succeeded',false)))) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Stripe head restart requires current retained owed facts';
    END IF;
    RETURN NEW;
  END IF;
  IF current-array['claim','retryAt','turn']::text[] IS NOT DISTINCT FROM prior-array['claim','retryAt','turn']::text[] THEN
    IF NEW.attempts<>OLD.attempts+1 OR NEW.retry_at<=checked OR NEW.retry_at>checked+interval '1 hour' THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Stripe failure preserves work and uses bounded retry accounting'; END IF;
    IF prior->>'kind'='scanning' THEN
      FOR offset_index IN 1..cardinality(lanes) LOOP
        lane := lanes[((array_position(lanes,prior->>'turn')-1+offset_index)%cardinality(lanes))+1];
        IF current->'scans'->lane->>'kind'<>'complete' THEN next_lane:=lane; EXIT; END IF;
      END LOOP;
      IF next_lane IS NULL OR current->>'turn' IS DISTINCT FROM next_lane THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Stripe failure yields fairly without dropping owed work';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF prior->>'kind'<>'scanning' OR NEW.attempts IS DISTINCT FROM OLD.attempts OR NEW.retry_at<=checked OR NEW.retry_at>checked+interval '1 second' THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Durable Stripe progress has fixed due time independent of failure attempts'; END IF;
  IF current->>'kind'='deleting' THEN
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
      IF frame->>'kind'='selected' AND previous_frame->'afterId'<>'null'::jsonb AND
        (frame->'id'=previous_frame->'afterId' OR (frame->'rest') @> jsonb_build_array(previous_frame->'afterId')) THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Stripe page must advance beyond its prior cursor';
      END IF;
    ELSIF previous_frame->>'kind'='selected' THEN
      IF frame->>'kind'='selected' AND frame->'id'=previous_frame->'id' THEN
        IF prior->>'turn'<>'invoices' OR frame-'detail' IS DISTINCT FROM previous_frame-'detail'
          OR frame->'detail'->'afterId'='null'::jsonb OR frame->'detail'->'afterId' IS NOT DISTINCT FROM previous_frame->'detail'->'afterId' THEN
          RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Only invoice payment progress retains the selected resource';
        END IF;
      ELSIF frame->>'kind'='selected' THEN
        expected_frame := previous_frame || jsonb_build_object('id',previous_frame->'rest'->0,
          'rest',(previous_frame->'rest')-0,'detail',CASE WHEN prior->>'turn'='invoices' THEN '{"kind":"invoice-payments","afterId":null}'::jsonb ELSE '{"kind":"resource"}'::jsonb END);
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
      IF current->'scans'->lane->>'kind'<>'complete' THEN next_lane:=lane; EXIT; END IF;
    END LOOP;
    IF next_lane IS NULL OR current->>'turn' IS DISTINCT FROM next_lane THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Stripe scan progress must yield fairly'; END IF;
  END IF;
  RETURN NEW;
END;
$stripe_cleanup$;
