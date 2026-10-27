import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { z } from 'zod';
import { sharedAccount, type Account } from './room-command-facts';
import { createAppError } from '@daisy/errors';
import { loadAuthorizationAccount } from './authorization';
import { readEntitlementGrants } from './entitlement-grants';
import type { EntitlementGrant } from '@daisy/protocol';

const accessRow = z.object({
  roundId: z.string(),
  createdByActorId: z.string().nullable(),
  visibility: z.enum(['public', 'unlisted', 'private']),
  status: z.string(),
  revision: z.coerce.number().int().positive(),
  participants: z.array(
    z.object({
      id: z.string(),
      actorId: z.string(),
      role: z.string(),
      slot: z.number().int(),
      userId: z.string().nullable(),
    }),
  ),
});

/** One debater seat of a Round: the Round's authorization facts and the seat's account. */
export type RoundAnalysisAccess = {
  readonly round: {
    readonly kind: 'round';
    readonly roundId: string;
    readonly createdByActorId: string | null;
    readonly visibility: 'public' | 'unlisted' | 'private';
    readonly status: string;
    readonly revision: number;
    readonly participants: readonly {
      readonly actorId: string;
      readonly role: string;
      readonly slot: number;
    }[];
  };
  readonly seat: {
    readonly id: string;
    readonly actorId: string;
    readonly side: 'affirmative' | 'negative';
    readonly slot: number;
  };
  readonly account: Account;
  /** The seat account's own entitlement grants (ISSUE-779), read with the account. */
  readonly grants: readonly EntitlementGrant[];
};

/**
 * A human debater seat's access facts; NOT_FOUND for any other seat, so a
 * bot's or a judge's seat is never analysed. Advisory discovery reads do not
 * lock the account; claims keep its canonical fence through commit.
 */
export async function readRoundAnalysisAccess(
  tx: Pick<BunSQLDatabase, 'execute'>,
  target: { readonly roundId: string; readonly roundParticipantId: string },
  mode: 'discovery' | 'claim',
): Promise<RoundAnalysisAccess> {
  const [row] =
    await tx.execute(sql`select r.id as "roundId", r.created_by_actor_id as "createdByActorId",
    r.visibility, r.status, r.version as revision,
    coalesce((select json_agg(json_build_object('id', p.id, 'actorId', p.actor_id, 'role', p.role, 'slot', p.slot, 'userId', a.user_id) order by p.id)
      from round_participants p join actors a on a.id = p.actor_id
      where p.round_id = r.id), '[]'::json) as participants
    from rounds r where r.id = ${target.roundId}`);
  if (!row || (row as { visibility: unknown }).visibility === null)
    throw createAppError('NOT_FOUND');
  const { participants, ...round } = accessRow.parse(row);
  const seat = participants.find((p) => p.id === target.roundParticipantId);
  if (
    !seat?.userId ||
    (seat.role !== 'affirmative' && seat.role !== 'negative')
  )
    throw createAppError('NOT_FOUND');
  const account =
    mode === 'claim'
      ? await sharedAccount(tx, { userId: seat.userId, actorId: seat.actorId })
      : await loadAuthorizationAccount(tx, seat.userId);
  return {
    round: {
      ...round,
      kind: 'round',
      participants: participants.map(({ actorId, role, slot }) => ({
        actorId,
        role,
        slot,
      })),
    },
    seat: {
      id: seat.id,
      actorId: seat.actorId,
      side: seat.role,
      slot: seat.slot,
    },
    account,
    grants: await readEntitlementGrants(tx, seat.userId),
  };
}
