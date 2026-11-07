import { sql } from 'drizzle-orm';
import type { BoundedTransactionContext } from '../transaction-context';
import { eligible } from './eligible';
/** Round dedupe precedes LIMIT; actual all-member history survives finished siblings. Lock skips happen before the bound. */
export async function select(
  tx: BoundedTransactionContext,
  lane: 'attached' | 'detached',
) {
  const live = sql`not exists(select 1 from necessary_evidence live
    where live.original_round_id=e.original_round_id and live.state='retiring' and live.lease_expires_at>clock_timestamp())`;
  const turn = sql`(select coalesce(max(history.last_claimed_at),min(history.created_at))
    from necessary_evidence history where history.original_round_id=e.original_round_id)`;
  const query =
    lane === 'attached'
      ? sql`select e.id from rounds r cross join lateral (
        select e.id,e.original_round_id from necessary_evidence e where e.round_id=r.id and ${eligible}
        order by e.created_at,e.id limit 1
      ) e where ${live} order by ${turn},e.original_round_id
      for no key update of r skip locked limit 1`
      : sql`select e.id from necessary_evidence e join (
        select distinct on (e.original_round_id) e.id from necessary_evidence e
        where e.round_id is null and ${eligible} and ${live}
        order by e.original_round_id,e.created_at,e.id
      ) due on due.id=e.id order by ${turn},e.original_round_id
      for update of e skip locked limit 1`;
  const [row] = (await tx.execute(query)) as unknown as { id: string }[];
  return row?.id ?? null;
}
