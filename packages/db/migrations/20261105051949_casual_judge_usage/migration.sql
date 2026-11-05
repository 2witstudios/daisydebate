-- This forward migration keeps all existing attribution/count/restoration facts.
-- The exclusive ALTER lock encloses the migration-only representation update.
ALTER TABLE usage_reservations DROP CONSTRAINT usage_reservations_state_check;
--> statement-breakpoint
ALTER TABLE usage_reservations DROP CONSTRAINT usage_reservations_count_check;
--> statement-breakpoint
ALTER TABLE usage_reservations DISABLE TRIGGER usage_attribution_immutable;
--> statement-breakpoint
-- Existing bot counts were recorded immediately before model dispatch; only add their basis.
UPDATE usage_reservations SET state=state||'{"countBasis":"dispatch_record"}'::jsonb
WHERE state ? 'countedAt' AND NOT state ? 'countBasis';
--> statement-breakpoint
ALTER TABLE usage_reservations ENABLE TRIGGER usage_attribution_immutable;
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
-- Historical casual judge cohort: original frozen sponsor and beta period.
-- This recognizes prior accounting evidence, not an exact vendor dispatch instant.
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
