import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { query, run } from '../raw-rows';
import type { Tx } from '../tx';

/** The database writes the hold and its private notification as one operation. */
export async function holdForGuardian(
  tx: Pick<Tx, 'execute'>,
  input: {
    readonly pair: {
      readonly lowActorId: string;
      readonly highActorId: string;
    };
    readonly childActorId: string;
    readonly at: string;
    readonly nextId: () => string;
  },
) {
  const { pair, childActorId, at, nextId } = input;
  const args = sql`${nextId()}, ${pair.lowActorId}, ${pair.highActorId},
    ${childActorId}, ${at}::timestamptz`;
  const [plan] = await query(
    tx,
    z.object({ slots: z.number().int().nonnegative() }),
    sql`select public.daisy_hold_friend_request(${args}) as slots`,
  );
  if (!plan?.slots) return;
  const ids = Array.from({ length: plan.slots }, () => sql`${nextId()}`);
  await run(
    tx,
    sql`select public.daisy_hold_friend_request(${args},
      ARRAY[${sql.join(ids, sql`,`)}]::text[])`,
  );
}
