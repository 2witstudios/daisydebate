import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { z } from 'zod';
import { sharedAccount, type Account } from './room-command-facts';
import { createAppError } from '@daisy/errors';
import { loadAuthorizationAccount } from './authorization';

const accessRow = z.object({
  roundId: z.string(),
  createdByActorId: z.string().nullable(),
  visibility: z.enum(['public', 'unlisted', 'private']),
  status: z.string(),
  revision: z.coerce.number().int().positive(),
  participants: z.array(
    z.object({
      actorId: z.string(),
      role: z.string(),
      slot: z.number().int(),
      userId: z.string().nullable(),
    }),
  ),
});
export type RoundCoachingAccess = {
  readonly round: Omit<z.infer<typeof accessRow>, 'participants'> & {
    readonly kind: 'round';
    readonly participants: readonly {
      readonly actorId: string;
      readonly role: string;
      readonly slot: number;
    }[];
  };
  readonly accounts: readonly Account[];
};

/** Advisory discovery reads do not lock accounts; claims retain canonical fences through commit. */
export async function readRoundCoachingAccess(
  tx: Pick<BunSQLDatabase, 'execute'>,
  roundId: string,
  mode: 'discovery' | 'claim',
): Promise<RoundCoachingAccess> {
  const [row] =
    await tx.execute(sql`select r.id as "roundId", r.created_by_actor_id as "createdByActorId",
    r.visibility, r.status, r.version as revision,
    coalesce((select json_agg(json_build_object('actorId', p.actor_id, 'role', p.role, 'slot', p.slot, 'userId', a.user_id) order by a.user_id)
      from round_participants p join actors a on a.id = p.actor_id
      where p.round_id = r.id), '[]'::json) as participants
    from rounds r where r.id = ${roundId}`);
  if (!row || (row as { visibility: unknown }).visibility === null)
    throw createAppError('NOT_FOUND');
  const { participants, ...round } = accessRow.parse(row);
  const accounts: Account[] = [];
  for (const seat of participants) {
    if (!seat.userId || !['affirmative', 'negative'].includes(seat.role))
      continue;
    accounts.push(
      mode === 'claim'
        ? await sharedAccount(tx, {
            userId: seat.userId,
            actorId: seat.actorId,
          })
        : await loadAuthorizationAccount(tx, seat.userId),
    );
  }
  return { round: { ...round, kind: 'round', participants }, accounts };
}
