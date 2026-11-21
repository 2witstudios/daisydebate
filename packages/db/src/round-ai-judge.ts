import { sql } from 'drizzle-orm';
import type { Tx } from './tx';
import { query } from './raw-rows';
import { z } from 'zod';

/** Frozen selected cast, not whether any judge worker has started. */
export async function roundHasAiJudge(tx: Tx, roundId: string) {
  const [row] = await query(
    tx,
    z.object({ selected: z.boolean() }),
    sql`select exists(select 1 from round_participants p
    join actors a on a.id=p.actor_id where p.round_id=${roundId} and p.seat_kind='judge' and public.daisy_round_participant_is_current(p.id) and a.kind='bot') as selected`,
  );
  if (!row) throw new Error('Round judge selection is missing');
  return row.selected;
}
