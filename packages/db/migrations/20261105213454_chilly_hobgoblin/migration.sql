ALTER TABLE "privacy_jobs" ADD COLUMN "billing_cleanup" jsonb;--> statement-breakpoint
ALTER TABLE "privacy_jobs" ADD CONSTRAINT "privacy_jobs_billing_cleanup_is_object" CHECK (jsonb_typeof("billing_cleanup") = 'object');--> statement-breakpoint
ALTER TABLE "privacy_jobs" ADD CONSTRAINT "privacy_jobs_billing_cleanup_scope" CHECK ("billing_cleanup" is null or
      coalesce(("vendor"='stripe' and "billing_cleanup"->>'jobId'="id"
        and case "billing_cleanup"->>'kind'
          when 'acknowledged' then "status"='succeeded'
          when 'scanning' then "status"='pending'
          when 'deleting' then "status"='pending'
          else false end),false));--> statement-breakpoint
-- Billing owns only Stripe execution. Rotation discards authority, never financial facts.
CREATE FUNCTION public.daisy_guard_stripe_cleanup() RETURNS trigger
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
  lanes text[] := array['purchases','subscriptions','invoices','refunds'];
  next_lane text;
  offset_index integer;
BEGIN
  IF TG_OP='UPDATE' AND (OLD.vendor='stripe' OR NEW.vendor='stripe')
    AND (NEW.subject_ref,NEW.vendor) IS DISTINCT FROM (OLD.subject_ref,OLD.vendor) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Stripe cleanup subject and vendor are immutable';
  END IF;
  IF NEW.vendor<>'stripe' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND NEW.id IS DISTINCT FROM OLD.id THEN
    NEW.billing_cleanup := NULL;
    RETURN NEW;
  END IF;
  current := NEW.billing_cleanup;
  prior := CASE WHEN TG_OP='UPDATE' THEN OLD.billing_cleanup ELSE NULL END;
  IF current IS NULL THEN
    IF prior IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Stripe authority clears only on job rotation';
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
      OR current->'scans' IS DISTINCT FROM '{"purchases":{"kind":"page","afterId":null},"subscriptions":{"kind":"page","afterId":null},"invoices":{"kind":"page","afterId":null},"refunds":{"kind":"page","afterId":null}}'::jsonb
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
    IF current->>'outcome'='vendor-deleted' AND prior->>'kind'<>'deleting' THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Stripe deletion requires completed scans'; END IF;
    IF current->>'outcome'='no-vendor-effects' AND (
      EXISTS(SELECT 1 FROM public.billing_customers WHERE user_id=NEW.subject_ref)
      OR EXISTS(SELECT 1 FROM public.billing_purchases WHERE user_id=NEW.subject_ref AND state->>'kind' NOT IN ('admitted','abandoned','expired'))
      OR EXISTS(SELECT 1 FROM public.billing_refund_actions WHERE user_id=NEW.subject_ref)) THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Missing customer alone does not prove absence of vendor effects'; END IF;
    RETURN NEW;
  END IF;
  IF current-array['claim','retryAt']::text[] IS NOT DISTINCT FROM prior-array['claim','retryAt']::text[] THEN
    IF NEW.attempts<>OLD.attempts+1 OR NEW.retry_at<=checked OR NEW.retry_at>checked+interval '1 hour' THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Stripe failure preserves work and uses bounded retry accounting'; END IF;
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
    FOREACH lane IN ARRAY lanes LOOP
      IF lane<>prior->>'turn' AND current->'scans'->lane IS DISTINCT FROM prior->'scans'->lane THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Stripe progress changes only its selected lane'; END IF;
    END LOOP;
    FOR offset_index IN 1..4 LOOP
      lane := lanes[((array_position(lanes,prior->>'turn')-1+offset_index)%4)+1];
      IF current->'scans'->lane->>'kind'<>'complete' THEN next_lane:=lane; EXIT; END IF;
    END LOOP;
    IF next_lane IS NULL OR current->>'turn' IS DISTINCT FROM next_lane THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Stripe scan progress must yield fairly'; END IF;
  END IF;
  RETURN NEW;
END;
$stripe_cleanup$;
--> statement-breakpoint
CREATE TRIGGER stripe_cleanup_execution BEFORE INSERT OR UPDATE ON public.privacy_jobs
FOR EACH ROW EXECUTE FUNCTION public.daisy_guard_stripe_cleanup();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.daisy_guard_stripe_cleanup() FROM PUBLIC;
