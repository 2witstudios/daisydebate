import { lifecycleSql } from './lifecycle-sql';
import { createAppError } from '@daisy/errors';
import { roundStatus } from '@daisy/protocol/round';
import {
  judgingWorkKinds,
  type JudgingWorkKind,
} from '@daisy/protocol/judging-policy';
import { sql } from 'drizzle-orm';
import type { Tx } from './tx';
import { query } from './raw-rows';
import { z } from 'zod';

type DueJudge = {
  readonly roundId: string;
  readonly judgeParticipantId: string;
  readonly holdsBallot: boolean;
};

/** Advisory discovery pages eligible Rounds, never siblings a live claim fences. */
export async function discoverRoundJudgingJobs(
  tx: Tx,
  limit: number,
  workKind: JudgingWorkKind,
): Promise<readonly DueJudge[]> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64)
    throw createAppError('VALIDATION');
  if (!judgingWorkKinds.includes(workKind)) throw createAppError('VALIDATION');
  const lane = sql`and holds_ballot=${workKind === 'submission'}`;
  return await query(
    tx,
    z.object({
      roundId: z.string(),
      judgeParticipantId: z.string(),
      holdsBallot: z.boolean(),
    }),
    sql`
    with sampled as materialized (select clock_timestamp() as now),
    turns as (
      select j.round_id,max(j.last_claimed_at) as last_claimed_at,
        min(j.created_at) as first_created_at
      from round_judging_jobs j join rounds r on r.id=j.round_id
      where r.status=${lifecycleSql(roundStatus.active)} group by j.round_id
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
      where public.daisy_round_participant_is_current(j.judge_participant_id) and ((j.status in ('queued','recovering') and (j.retry_at is null or j.retry_at<=s.now))
          or (j.status='leased' and j.lease_expires_at<=s.now))
        and not exists (
          select 1 from round_judging_jobs active
          where active.round_id=j.round_id and public.daisy_round_participant_is_current(active.judge_participant_id) and active.status='leased'
            and active.lease_expires_at>s.now
        )
    )
    select round_id as "roundId",judge_participant_id as "judgeParticipantId",
      holds_ballot as "holdsBallot"
    from due where round_turn=1 ${lane}
    order by service_turn_at,round_id,created_at,judge_participant_id
    limit ${limit}
  `,
  );
}
