import { sql } from 'drizzle-orm';
import type { Tx } from './tx';

/** Frozen selected cast, not whether any judge worker has started. */
export async function roundHasAiJudge(tx: Tx, roundId: string) {
  const [row] =
    await tx.execute(sql`select exists(select 1 from round_participants p
    join actors a on a.id=p.actor_id where p.round_id=${roundId} and p.seat_kind='judge' and public.daisy_round_participant_is_current(p.id) and a.kind='bot') as selected`);
  return (row as { selected: boolean }).selected;
}
