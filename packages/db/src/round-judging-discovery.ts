import { createAppError } from '@daisy/errors';
import { sql } from 'drizzle-orm';
import type { BoundedTransactionContext } from './transaction-context';

type DueJudge = {
  readonly roundId: string;
  readonly judgeParticipantId: string;
  readonly holdsBallot: boolean;
};

/** Advisory discovery pages eligible Rounds, never siblings a live claim fences. */
export async function discoverRoundJudgingJobs(
  tx: BoundedTransactionContext,
  limit: number,
): Promise<readonly DueJudge[]> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64)
    throw createAppError('VALIDATION');
  return (await tx.execute(sql`
    with sampled as materialized (select clock_timestamp() as now),
    turns as (
      select j.round_id,max(j.last_claimed_at) as last_claimed_at,
        min(j.created_at) as first_created_at
      from round_judging_jobs j join rounds r on r.id=j.round_id
      where r.status='active' group by j.round_id
    ),
    due as (
      select j.round_id,j.judge_participant_id,
        j.pending_ballot is not null as holds_ballot,
        j.created_at,
        coalesce(t.last_claimed_at,t.first_created_at) as service_turn_at,
        row_number() over (partition by j.round_id
          order by (j.pending_ballot is null),j.created_at,j.judge_participant_id) as round_turn
      from round_judging_jobs j
      join turns t on t.round_id=j.round_id
      cross join sampled s
      where ((j.status in ('queued','recovering') and (j.retry_at is null or j.retry_at<=s.now))
          or (j.status='leased' and j.lease_expires_at<=s.now))
        and not exists (
          select 1 from round_judging_jobs active
          where active.round_id=j.round_id and active.status='leased'
            and active.lease_expires_at>s.now
        )
    )
    select round_id as "roundId",judge_participant_id as "judgeParticipantId",
      holds_ballot as "holdsBallot"
    from due where round_turn=1
    order by service_turn_at,round_id,created_at,judge_participant_id
    limit ${limit}
  `)) as unknown as readonly DueJudge[];
}
