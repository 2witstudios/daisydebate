import { sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type { BoundedTransactionContext } from './transaction-context';

/** Discovery is advisory. Claiming rechecks account, Round, seat and segment under locks. */
export async function scanBotWorkers(
  tx: Pick<BoundedTransactionContext, 'execute'>,
  limit: number,
) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64)
    throw createAppError('VALIDATION');
  const rows =
    await tx.execute(sql`with observed as materialized (select clock_timestamp() as at)
    select r.id as round_id,p.id as seat_id,s.id as segment_id
    from rounds r
    join round_participants p on p.round_id=r.id and p.role in ('affirmative','negative')
    join actors a on a.id=p.actor_id and a.kind='bot'
    join bot_profiles b on b.actor_id=a.id
    cross join observed n
    join lateral (select id from round_segments where round_id=r.id and started_at<=n.at
      order by sequence desc limit 1) s on true
    where r.status='active' and not exists (
      select 1 from round_bot_publications c
      join agent_runs run on run.id=c.agent_run_id and run.round_participant_id=p.id
      where c.round_id=r.id and c.round_participant_id=p.id and c.segment_id=s.id
        and c.lease_expires_at>n.at and run.ended_at is null
    ) order by r.created_at,r.id,p.id limit ${limit}`);
  return (
    rows as { round_id: string; seat_id: string; segment_id: string }[]
  ).map((row) => ({
    roundId: row.round_id,
    roundParticipantId: row.seat_id,
    segmentId: row.segment_id,
  }));
}
