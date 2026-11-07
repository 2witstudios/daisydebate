import { sql } from 'drizzle-orm';
import type { BoundedTransactionContext } from '../transaction-context';
/** Boolean only, under the caller's owning Round lock. No payload, account lock or privacy authority is borrowed. */
export async function pending(
  tx: BoundedTransactionContext,
  roundId: string,
): Promise<boolean> {
  const [row] = (await tx.execute(sql`select
    exists(select 1 from necessary_evidence e
      where e.original_round_id=${roundId}
      and not exists(select 1 from transcription_recovery_sources s
        join transcription_recovery_contexts c on c.id=s.context_id
        where s.evidence_id=e.id and c.round_id=${roundId} and c.status='selected'))
    or exists(select 1 from transcription_recovery_contexts c
      where c.round_id=${roundId} and c.status<>'selected') as pending`)) as unknown as {
    pending: boolean;
  }[];
  return row?.pending !== false;
}
