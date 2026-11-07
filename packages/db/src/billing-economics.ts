import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type { BoundedTransaction } from './bounded-transaction';
import { currentWebTransaction } from './web-service-authority';

import { billingEconomicsSnapshotSchema } from '@daisy/protocol/billing-economics';
const instant = z.iso.datetime({ precision: 3 });
/** Service-only read: one READ COMMITTED statement, no identifiers/content in the result and no current-grant attribution. */
export function createBillingEconomicsReader(input: {
  readonly run: BoundedTransaction;
  readonly instanceId: string;
}) {
  const run = currentWebTransaction(input.run, input.instanceId);
  return {
    read(window: { readonly startsAt: string; readonly endsAt: string }) {
      if (
        !instant.safeParse(window.startsAt).success ||
        !instant.safeParse(window.endsAt).success ||
        Date.parse(window.endsAt) <= Date.parse(window.startsAt) ||
        Date.parse(window.endsAt) - Date.parse(window.startsAt) > 32 * 86400000
      )
        throw createAppError('VALIDATION');
      return run(async (tx) => {
        const rows = await tx.execute(sql`
with agent_facts as (
 select case when a.kind='judging' then 'casual_ai_judge' when a.kind in ('tts','stt') then 'speech' else 'ai_round' end as feature,
 a.model,a.provider,a.started_at as at,
 case when a.kind='judging' then j.answered_at is not null else a.configuration_snapshot->>'providerOutcome'='received' end as known,
 case when a.kind='judging' then j.category='provider_refused' else a.configuration_snapshot->>'providerOutcome'='failed' end as definite,
 a.input_tokens,a.output_tokens,a.characters,greatest(a.requests,1) as call_count,
 case when a.kind='judging' and r.competition_type='ranked' then 'ranked' when u.n=1 then u.source->>'kind' else 'unattributed' end as source_kind,
 case when u.n=1 then u.source->>'startsAt' end as source_starts_at,
 case when u.n=1 then u.source->>'endsAt' end as source_ends_at
 from agent_runs a join round_participants p on p.id=a.round_participant_id join rounds r on r.id=p.round_id
 left join round_judging_attempts j on j.agent_run_id=a.id
 left join lateral (select count(*) as n,(array_agg(x.source))[1] as source from usage_reservations x
 where x.round_id=r.id and x.actor_id=r.created_by_actor_id and x.reserved_at<=a.started_at and x.kind=case when a.kind='judging' then 'casual_ai_judge' else 'ai_round' end) u on true
 where a.started_at>=${window.startsAt}::timestamptz and a.started_at<${window.endsAt}::timestamptz
 and (a.requests>0 or a.input_tokens>0 or a.output_tokens>0 or a.characters>0 or j.agent_run_id is not null)
), analysis_facts as (
 select 'round_analysis'::text as feature,c.value->>'model' as model,'openrouter'::text as provider,(c.value->>'dispatchedAt')::timestamptz as at,
 c.value->'outcome'->>'kind'='received' as known,c.value->'outcome'->>'kind'='definite_failure' as definite,
 coalesce((c.value->'outcome'->>'inputTokens')::bigint,0) as input_tokens,coalesce((c.value->'outcome'->>'outputTokens')::bigint,0) as output_tokens,0::bigint as characters,1::bigint as call_count,
 coalesce(u.source->>'kind','unattributed') as source_kind,u.source->>'startsAt' as source_starts_at,u.source->>'endsAt' as source_ends_at
 from round_analyses a join round_participants p on p.id=a.round_participant_id
 left join usage_reservations u on u.round_id=a.round_id and u.actor_id=p.actor_id and u.kind='round_analysis' and u.reserved_at=(case when a.work->>'kind'='purged' then a.work->'request'->>'requestedAt' else a.work->>'requestedAt' end)::timestamptz
 cross join lateral jsonb_array_elements(coalesce(case when a.work->>'kind'='purged' then a.work->'request'->'calls' else a.work->'calls' end,'[]'::jsonb)) c(value)
 where (c.value->>'dispatchedAt')::timestamptz>=${window.startsAt}::timestamptz and (c.value->>'dispatchedAt')::timestamptz<${window.endsAt}::timestamptz
), historical_analysis as (
 select 'round_analysis'::text as feature,a.work->'historical'->>'model' as model,'unrecorded'::text as provider,
 (a.work->'historical'->>'createdAt')::timestamptz as at,
 ((a.work->'historical'->>'inputTokens')::bigint>0 or (a.work->'historical'->>'outputTokens')::bigint>0) as known,
 false as definite, (a.work->'historical'->>'inputTokens')::bigint as input_tokens,(a.work->'historical'->>'outputTokens')::bigint as output_tokens,
 0::bigint as characters,greatest((a.work->'historical'->>'claimedAttempts')::bigint,1) as call_count,
 coalesce(u.source->>'kind','unattributed') as source_kind,u.source->>'startsAt' as source_starts_at,u.source->>'endsAt' as source_ends_at
 from round_analyses a join round_participants p on p.id=a.round_participant_id
 left join usage_reservations u on u.round_id=a.round_id and u.actor_id=p.actor_id and u.kind='round_analysis' and u.reserved_at<=(a.work->'historical'->>'createdAt')::timestamptz
 where a.work->'historical'<>'null'::jsonb and (a.work->'historical'->>'createdAt')::timestamptz>=${window.startsAt}::timestamptz
 and (a.work->'historical'->>'createdAt')::timestamptz<${window.endsAt}::timestamptz
 and ((a.work->'historical'->>'claimedAttempts')::bigint>0 or (a.work->'historical'->>'inputTokens')::bigint>0 or (a.work->'historical'->>'outputTokens')::bigint>0)
), attempts as (
 select feature,model,provider,source_kind,source_starts_at,source_ends_at,
 to_char(min(at) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as first_at,
 to_char(max(at) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as last_at,
 sum(call_count) as runs,count(*) filter(where known is true) as known_responses,count(*) filter(where known is true and input_tokens=0 and output_tokens=0) as unmeasured_responses,sum(case when known is true or definite is true then call_count-1 else call_count end) as unknown_calls,count(*) filter(where definite is true and known is not true) as definite_failures,
 coalesce(sum(input_tokens) filter(where known is true),0) as input_tokens,coalesce(sum(output_tokens) filter(where known is true),0) as output_tokens,coalesce(sum(characters) filter(where known is true),0) as characters
 from (select * from agent_facts union all select * from analysis_facts union all select * from historical_analysis) f
 group by feature,model,provider,source_kind,source_starts_at,source_ends_at,date_trunc('day',at at time zone 'UTC')
 order by feature,model,provider,source_kind,source_starts_at,source_ends_at,min(at) limit 1001
), usage as (
 select kind as feature,source->>'kind' as source_kind,source->>'startsAt' as source_starts_at,source->>'endsAt' as source_ends_at,state->>'kind' as state,state->>'providerOutcome' as provider_outcome,state->>'countBasis' as count_basis,count(*) as reservations
 from usage_reservations where reserved_at>=${window.startsAt}::timestamptz and reserved_at<${window.endsAt}::timestamptz
 group by kind,source->>'kind',source->>'startsAt',source->>'endsAt',state->>'kind',state->>'providerOutcome',state->>'countBasis'
 order by kind,source->>'kind',source->>'startsAt',source->>'endsAt',state->>'kind',state->>'providerOutcome',state->>'countBasis' limit 1001
)
 select jsonb_build_object('startsAt',${window.startsAt}::text,'endsAt',${window.endsAt}::text,'observedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'attempts',coalesce((select jsonb_agg(jsonb_build_object('feature',feature,'model',model,'provider',provider,'sourceKind',source_kind,'sourceStartsAt',source_starts_at,'sourceEndsAt',source_ends_at,'firstAt',first_at,'lastAt',last_at,'runs',runs,'knownResponses',known_responses,'unmeasuredResponses',unmeasured_responses,'unknownCalls',unknown_calls,'definiteFailures',definite_failures,'inputTokens',input_tokens,'outputTokens',output_tokens,'characters',characters)) from attempts),'[]'::jsonb),
 'usage',coalesce((select jsonb_agg(jsonb_build_object('feature',feature,'sourceKind',source_kind,'sourceStartsAt',source_starts_at,'sourceEndsAt',source_ends_at,'state',state,'providerOutcome',provider_outcome,'countBasis',count_basis,'reservations',reservations)) from usage),'[]'::jsonb)) as snapshot`);
        const parsed = billingEconomicsSnapshotSchema.safeParse(
          rows[0]?.snapshot,
        );
        if (!parsed.success)
          throw createAppError(
            'INFRASTRUCTURE',
            'Billing economics snapshot unavailable',
          );
        return {
          ...parsed.data,
          complete:
            parsed.data.attempts.length < 1001 &&
            parsed.data.usage.length < 1001,
        };
      });
    },
  };
}
