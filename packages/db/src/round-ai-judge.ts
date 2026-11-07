import { sql } from 'drizzle-orm';
import type { BoundedTransactionContext } from './transaction-context';

/** Frozen selected cast, not whether any judge worker has started. */
export async function roundHasAiJudge(
  tx: Pick<BoundedTransactionContext, 'execute'>,
  roundId: string,
) {
  const [row] =
    await tx.execute(sql`select exists(select 1 from round_participants p
    join actors a on a.id=p.actor_id where p.round_id=${roundId} and p.role='judge' and a.kind='bot') as selected`);
  return (row as { selected: boolean }).selected;
}
