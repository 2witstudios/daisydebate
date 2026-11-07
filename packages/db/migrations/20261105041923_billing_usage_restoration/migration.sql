ALTER TABLE "usage_reservations" DROP CONSTRAINT "usage_reservations_state_check", ADD CONSTRAINT "usage_reservations_state_check" CHECK (coalesce(case "state"->>'kind'
      when 'reserved' then "state"='{"kind":"reserved"}'::jsonb
      when 'released' then "state"-array['kind','releasedAt']='{}'::jsonb
        and jsonb_typeof("state"->'releasedAt')='string'
        and isfinite(("state"->>'releasedAt')::timestamptz)
        and ("state"->>'releasedAt')::timestamptz>="reserved_at"
      when 'dispatched' then "state"-array['kind','countedAt']='{}'::jsonb
      when 'unknown' then "state"-array['kind','countedAt']='{}'::jsonb
      when 'delivered' then "state"-array['kind','countedAt']='{}'::jsonb
      when 'refunded' then "state"-array['kind','countedAt','refundedAt']='{}'::jsonb
        and jsonb_typeof("state"->'refundedAt')='string'
        and isfinite(("state"->>'refundedAt')::timestamptz)
        and ("state"->>'refundedAt')::timestamptz>=("state"->>'countedAt')::timestamptz
      when 'credited' then "kind"='ai_round'
        and "state"-array['kind','countedAt','creditedAt','provenance','providerOutcome']='{}'::jsonb
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
      else false end, false));--> statement-breakpoint
-- Repair only the predecessor's beta ledger using preserved Round/provider facts.
-- ALTER holds an exclusive table lock until commit: no runtime writer can observe
-- the temporary absence of the attribution guard or use it to rewrite history.
ALTER TABLE usage_reservations DISABLE TRIGGER usage_attribution_immutable;
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
ALTER TABLE usage_reservations ENABLE TRIGGER usage_attribution_immutable;
