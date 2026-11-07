import { analysisWorkSchema } from '@daisy/protocol';
import { sql, type SQL } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
} from 'drizzle-orm/pg-core';
import { createdAtColumn, jsonbColumn, jsonbIsObject } from './columns';
import { roundParticipants } from './round-participants';
import { rounds } from './rounds';
import { roundTranscriptFreezes } from './round-transcript-freezes';

/**
 * The original frozen debater seat is the report/request identity. Content may
 * expire without deleting its immutable freeze or this terminal identity.
 * Admission also verifies the actual retained transcript under current authority.
 */
export const roundAnalyses = pgTable(
  'round_analyses',
  {
    roundId: text('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    roundParticipantId: text('round_participant_id')
      .primaryKey()
      .references(() => roundParticipants.id, { onDelete: 'cascade' }),
    freezeRevision: integer('freeze_revision').notNull(),
    work: jsonbColumn('work', analysisWorkSchema).notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => {
    const work = table.work;
    const history = sql`(${work}->'historical')`;
    const request = sql`(case when ${work}->>'kind'='purged' then ${work}->'request' when ${work} ? 'requestedAt' then ${work}-array['kind','historical','lease','report','reason','completedAt'] else 'null'::jsonb end)`;
    return [
      foreignKey({
        name: 'round_analyses_freeze_revision_fk',
        columns: [table.roundId, table.freezeRevision],
        foreignColumns: [
          roundTranscriptFreezes.roundId,
          roundTranscriptFreezes.revision,
        ],
      }).onDelete('cascade'),
      jsonbIsObject('round_analyses', work),
      check(
        'round_analyses_freeze_revision_check',
        sql`${table.freezeRevision} > 0`,
      ),
      check(
        'round_analyses_work_kind_check',
        sql`coalesce(${work}->>'kind' in ('unrequested','retained','retired','queued','leased','succeeded','failed','purged'),false)`,
      ),
      check(
        'round_analyses_history_check',
        sql`coalesce(${history}='null'::jsonb or (
        jsonb_typeof(${history})='object'
        and ${history} ?& array['createdAt','completedAt','claimedAttempts','model','inputTokens','outputTokens']
        and ${history}-array['createdAt','completedAt','claimedAttempts','model','inputTokens','outputTokens']='{}'::jsonb
        and (${history}->>'createdAt')::timestamptz=${table.createdAt}
        and isfinite((${history}->>'createdAt')::timestamptz)
        and (${history}->'completedAt'='null'::jsonb or (isfinite((${history}->>'completedAt')::timestamptz) and (${history}->>'completedAt')::timestamptz>=${table.createdAt}))
        and ${nonnegative(sql`${history}->'claimedAttempts'`)}
        and ${nonnegative(sql`${history}->'inputTokens'`)}
        and ${nonnegative(sql`${history}->'outputTokens'`)}
        and jsonb_typeof(${history}->'model')='string' and length(${history}->>'model')>0
      ),false)`,
      ),
      check(
        'round_analyses_request_check',
        sql`coalesce(${request}='null'::jsonb or (${requestFacts(request)}
        and (${history}='null'::jsonb or (${history}->'completedAt'='null'::jsonb and (${request}->>'requestedAt')::timestamptz>=${table.createdAt}))
        and coalesce((${history}->>'claimedAttempts')::integer,0)+jsonb_array_length(${request}->'calls')<=2
        and (not (${work}->>'kind'='queued') or ((${request}->>'claims')::integer<4 and coalesce((${history}->>'claimedAttempts')::integer,0)+jsonb_array_length(${request}->'calls')<2))
      ),false)`,
      ),
      check(
        'round_analyses_work_authority_check',
        sql`coalesce(case ${work}->>'kind'
        when 'unrequested' then jsonb_typeof(${history})='object' and ${history}->'completedAt'='null'::jsonb and ${work}-array['kind','historical']='{}'::jsonb
        when 'retained' then jsonb_typeof(${history})='object' and ${history}->'completedAt'<>'null'::jsonb and jsonb_typeof(${work}->'report')='object' and ${work}-array['kind','historical','report']='{}'::jsonb
        when 'retired' then jsonb_typeof(${history})='object' and ${history}->'completedAt'<>'null'::jsonb and ${work}->>'reason' in ('failed','erased') and ${work}-array['kind','historical','reason']='{}'::jsonb
        when 'purged' then ${work} ?& array['request','purgedAt','completedAt','historical'] and ${work}-array['kind','request','purgedAt','completedAt','historical']='{}'::jsonb
          and (${history}<>'null'::jsonb or ${request}<>'null'::jsonb)
          and isfinite((${work}->>'purgedAt')::timestamptz)
          and (${work}->>'purgedAt')::timestamptz>=coalesce((${work}->>'completedAt')::timestamptz,(${request}->>'requestedAt')::timestamptz,${table.createdAt})
        else ${request}<>'null'::jsonb and ${work} ? 'historical'
          and ((${work}->>'kind'='leased') = (${work} ? 'lease'))
          and ((${work}->>'kind'='succeeded') = (${work} ? 'report'))
          and ((${work}->>'kind' in ('failed','succeeded')) = (${work} ? 'completedAt'))
          and ((${work}->>'kind'='failed') = (${work} ? 'reason'))
          and (not (${work}->>'kind'='failed') or ${work}->>'reason' in ('exhausted','authority','evidence','expired'))
          and (not (${work} ? 'completedAt') or (isfinite((${work}->>'completedAt')::timestamptz) and (${work}->>'completedAt')::timestamptz>=(${work}->>'requestedAt')::timestamptz))
          and (not (${work}->>'kind'='succeeded') or (jsonb_typeof(${work}->'report')='object' and (${work}->>'completedAt')::timestamptz<(${work}->>'deadlineAt')::timestamptz and (${work}->'calls'->0->'outcome'->>'kind'='received' or ${work}->'calls'->1->'outcome'->>'kind'='received')))
      end,false)`,
      ),
      check(
        'round_analyses_lease_check',
        sql`coalesce(${work}->>'kind'<>'leased' or (${leaseFacts(sql`(${work}->'lease')`, request)}),false)`,
      ),
      index('round_analyses_pending_idx').on(
        sql`(${work}->>'kind')`,
        sql`(${work}->>'requestedAt')`,
        table.roundParticipantId,
      ),
      index('round_analyses_freeze_revision_idx').on(
        table.roundId,
        table.freezeRevision,
      ),
      index('round_analyses_created_idx').on(table.createdAt),
    ];
  },
);

function nonnegative(value: SQL) {
  return sql`(jsonb_typeof(${value})='number' and (${value})::text ~ '^(0|[1-9][0-9]*)$' and (${value})::numeric<=9007199254740991)`;
}

function requestFacts(request: SQL) {
  return sql`jsonb_typeof(${request})='object'
    and ${request} ?& array['requestId','requestedAt','deadlineAt','evidenceLines','claims','calls']
    and ${request}-array['requestId','requestedAt','deadlineAt','evidenceLines','claims','calls']='{}'::jsonb
    and jsonb_typeof(${request}->'requestedAt')='string' and jsonb_typeof(${request}->'deadlineAt')='string'
    and ${request}->>'requestId' ~ '^[a-z][a-z0-9]{23}$'
    and isfinite((${request}->>'requestedAt')::timestamptz)
    and (${request}->>'deadlineAt')::timestamptz=(${request}->>'requestedAt')::timestamptz+interval '15 minutes'
    and ${nonnegative(sql`${request}->'evidenceLines'`)} and (${request}->>'evidenceLines')::integer>0
    and ${nonnegative(sql`${request}->'claims'`)} and (${request}->>'claims')::integer between 0 and 4
    and jsonb_typeof(${request}->'calls')='array' and jsonb_array_length(${request}->'calls')<=2
    and (${request}->>'claims')::integer>=jsonb_array_length(${request}->'calls')
    and (jsonb_array_length(${request}->'calls')<1 or (${callFacts(sql`(${request}->'calls'->0)`, request)}))
    and (jsonb_array_length(${request}->'calls')<2 or (${callFacts(sql`(${request}->'calls'->1)`, request)}
      and ${request}->'calls'->0->>'id'<>${request}->'calls'->1->>'id'
      and ${request}->'calls'->0->>'tokenDigest'<>${request}->'calls'->1->>'tokenDigest'))`;
}

function callFacts(call: SQL, request: SQL) {
  return sql`jsonb_typeof(${call})='object'
    and ${call} ?& array['id','tokenDigest','model','dispatchedAt','outcome']
    and ${call}-array['id','tokenDigest','model','dispatchedAt','outcome']='{}'::jsonb
    and ${call}->>'id' ~ '^[a-z][a-z0-9]{23}$'
    and jsonb_typeof(${call}->'dispatchedAt')='string' and jsonb_typeof(${call}->'tokenDigest')='string'
    and ${call}->>'tokenDigest' ~ '^[a-f0-9]{64}$'
    and jsonb_typeof(${call}->'model')='string' and length(${call}->>'model')>0
    and (${call}->>'dispatchedAt')::timestamptz>=(${request}->>'requestedAt')::timestamptz
    and (${call}->>'dispatchedAt')::timestamptz<(${request}->>'deadlineAt')::timestamptz
    and case ${call}->'outcome'->>'kind'
      when 'unknown' then ${call}->'outcome'='{"kind":"unknown"}'::jsonb
      when 'definite_failure' then ${call}->'outcome'='{"kind":"definite_failure"}'::jsonb
      when 'received' then (${call}->'outcome')-array['kind','inputTokens','outputTokens']='{}'::jsonb and ${nonnegative(sql`${call}->'outcome'->'inputTokens'`)} and ${nonnegative(sql`${call}->'outcome'->'outputTokens'`)}
      else false end`;
}

function leaseFacts(lease: SQL, request: SQL) {
  return sql`jsonb_typeof(${lease})='object'
    and ${lease} ?& array['callId','tokenDigest','model','claimedAt','expiresAt']
    and ${lease}-array['callId','tokenDigest','model','claimedAt','expiresAt']='{}'::jsonb
    and jsonb_typeof(${lease}->'claimedAt')='string' and jsonb_typeof(${lease}->'expiresAt')='string' and jsonb_typeof(${lease}->'tokenDigest')='string'
    and ${lease}->>'callId' ~ '^[a-z][a-z0-9]{23}$' and ${lease}->>'tokenDigest' ~ '^[a-f0-9]{64}$'
    and jsonb_typeof(${lease}->'model')='string' and length(${lease}->>'model')>0
    and (${request}->>'claims')::integer>0
    and (${lease}->>'claimedAt')::timestamptz>=(${request}->>'requestedAt')::timestamptz
    and (${lease}->>'expiresAt')::timestamptz>(${lease}->>'claimedAt')::timestamptz
    and (${lease}->>'expiresAt')::timestamptz<=(${lease}->>'claimedAt')::timestamptz+interval '3 minutes'
    and (${lease}->>'expiresAt')::timestamptz<=(${request}->>'deadlineAt')::timestamptz`;
}
