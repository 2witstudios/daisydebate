import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Account } from './room-command-facts';
import { createAppError } from '@daisy/errors';
import { loadAuthorizationAccount } from './authorization';
import { seatKinds, type SeatRef, type SideKey } from '@daisy/protocol/seats';
import { seatOfColumns } from './seat-columns';
import type { Tx } from './tx';
import { query } from './raw-rows';

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
      seatKind: z.enum(seatKinds),
      side: z.string().nullable(),
      slot: z.number().int(),
      userId: z.string().nullable(),
    }),
  ),
});

/** One debater seat of a Round: the Round's authorization facts and the seat's account. */
export type RoundAnalysisAccess = {
  readonly round: Omit<z.infer<typeof accessRow>, 'participants'> & {
    readonly kind: 'round';
    readonly participants: readonly {
      readonly actorId: string;
      readonly seat: SeatRef;
    }[];
  };
  /** A human debater's side seat: Round analysis reads a side's case. */
  readonly seat: {
    readonly id: string;
    readonly actorId: string;
    readonly side: SideKey;
    readonly slot: number;
  };
  readonly account: Account;
};

/**
 * A human debater seat's access facts; NOT_FOUND for any other seat, so a
 * bot's or a judge's seat is never analysed. The caller already holds the
 * canonical account fences; this reader never acquires or upgrades one.
 */
export async function readRoundAnalysisAccess(
  tx: Tx,
  target: { readonly roundId: string; readonly roundParticipantId: string },
): Promise<RoundAnalysisAccess> {
  const [row] = await query(
    tx,
    accessRow.extend({ visibility: accessRow.shape.visibility.nullable() }),
    sql`select r.id as "roundId", r.created_by_actor_id as "createdByActorId",
    r.visibility, r.status, r.version as revision,
    coalesce((select json_agg(json_build_object('id', p.id, 'actorId', p.actor_id, 'seatKind', p.seat_kind, 'side', p.side, 'slot', p.slot, 'userId', a.user_id) order by p.id)
      from round_participants p join actors a on a.id = p.actor_id
      where p.round_id = r.id), '[]'::json) as participants
    from rounds r where r.id = ${target.roundId}`,
  );
  if (!row || row.visibility === null) throw createAppError('NOT_FOUND');
  const { participants, visibility, ...round } = row;
  const seat = participants.find((p) => p.id === target.roundParticipantId);
  if (!seat?.userId || seat.seatKind !== 'side' || seat.side === null)
    throw createAppError('NOT_FOUND');
  const account = await loadAuthorizationAccount(tx, seat.userId);
  return {
    round: {
      ...round,
      visibility,
      kind: 'round',
      participants: participants.map(({ actorId, ...seat }) => ({
        actorId,
        seat: seatOfColumns(seat),
      })),
    },
    seat: {
      id: seat.id,
      actorId: seat.actorId,
      side: seat.side,
      slot: seat.slot,
    },
    account,
  };
}
