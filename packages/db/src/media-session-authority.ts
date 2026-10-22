import { createAppError } from '@daisy/errors';
import { idSchema, type RoundCommandAuthority } from '@daisy/protocol';
import { eq } from 'drizzle-orm';
import { lockAuthorizationActors } from './authorization';
import type { BoundedTransactionContext } from './transaction-context';
import { actorFact } from './room-command-facts';
import { hydrateRoundRows } from './round-hydration';
import { rounds } from './schema/rounds';
import { roundParticipants } from './schema/round-participants';

export const mediaId = (value: string) => {
  const parsed = idSchema.safeParse(value);
  if (!parsed.success) throw createAppError('VALIDATION');
  return parsed.data;
};

/** Account fences precede the Round fence, matching competitive writes and erasure. */
export async function lockMediaRound(
  tx: BoundedTransactionContext,
  roundId: string,
  actorId?: string,
) {
  mediaId(roundId);
  if (actorId !== undefined) mediaId(actorId);
  const seats = await tx
    .select({ actorId: roundParticipants.actorId })
    .from(roundParticipants)
    .where(eq(roundParticipants.roundId, roundId));
  const actorIds = [
    ...new Set([
      ...seats.map((seat) => seat.actorId),
      ...(actorId ? [actorId] : []),
    ]),
  ];
  const accounts = actorIds.length
    ? await lockAuthorizationActors(tx, actorIds, {
        maxActors: actorIds.length,
      })
    : [];
  const [row] = await tx
    .select({ status: rounds.status })
    .from(rounds)
    .where(eq(rounds.id, roundId))
    .for('update');
  if (!row) throw createAppError('NOT_FOUND');
  const round = await hydrateRoundRows(tx, roundId);
  if (!round) throw createAppError('NOT_FOUND');
  const participants: RoundCommandAuthority['participants'] = await Promise.all(
    round.participants.map(async (seat) => {
      if (!actorIds.includes(seat.actorId)) throw createAppError('CONFLICT');
      const actor = await actorFact(tx, seat.actorId);
      const account = accounts.find((entry) => entry?.actorId === seat.actorId);
      return {
        ...seat,
        kind: actor?.kind ?? 'human',
        eligible:
          actor?.kind === 'bot'
            ? actor.eligible
            : account?.member === true && !account.erased,
      };
    }),
  );
  const caller =
    actorId === undefined
      ? null
      : participants.find(
          (seat) =>
            seat.actorId === actorId && seat.kind === 'human' && seat.eligible,
        );
  if (actorId !== undefined && !caller) throw createAppError('AUTHORIZATION');
  return { participants, caller };
}

export function requireMediaWindow(
  status: string,
  now: string,
  finalEndedAt: string | null,
) {
  if (
    !['scheduled', 'active'].includes(status) ||
    (finalEndedAt !== null &&
      Date.parse(now) >= Date.parse(finalEndedAt) + 30 * 60_000)
  )
    throw createAppError('CONFLICT', 'Round media has ended');
}
