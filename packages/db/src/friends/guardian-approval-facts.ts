import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { query } from '../raw-rows';
import type { Tx } from '../tx';

export async function guardianHoldsForRequest(
  tx: Pick<Tx, 'execute'>,
  pair: { readonly lowActorId: string; readonly highActorId: string },
  requesterActorId: string,
) {
  const rows = await query(
    tx,
    z.object({ child_actor_id: z.string() }),
    sql`select child_actor_id from public.daisy_friend_guardian_holds(
      ${pair.lowActorId}, ${pair.highActorId}, ${requesterActorId})`,
  );
  return rows.map(({ child_actor_id }) => child_actor_id);
}
