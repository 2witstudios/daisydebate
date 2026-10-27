import { createAppError } from '@daisy/errors';
import { idSchema, type RoundCommandAuthority } from '@daisy/protocol';
import { eq } from 'drizzle-orm';
import { lockAuthorizationActors } from './authorization';
import type { BoundedTransactionContext } from './transaction-context';
import { actorFact } from './room-command-facts';
import { hydrateRoundRows } from './round-hydration';
import { rounds } from './schema/rounds';
import { roundParticipants } from './schema/round-participants';
import { fencedActorIds, seatEligibility } from './seat-eligibility';

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
  const [initial] = await tx
    .select({ hostActorId: rounds.createdByActorId })
    .from(rounds)
    .where(eq(rounds.id, roundId));
  // A human gets the unseated refusal for a missing Round: no existence oracle.
  const missing = () =>
    actorId === undefined ? createAppError('NOT_FOUND') : unseatedRefusal();
  if (!initial) throw missing();
  const actorIds = fencedActorIds(seats, initial.hostActorId, actorId);
  const accounts = actorIds.length
    ? await lockAuthorizationActors(tx, actorIds, {
        maxActors: actorIds.length,
      })
    : [];
  const [row] = await tx
    .select({ status: rounds.status })
    .from(rounds)
    .where(eq(rounds.id, roundId))
    .for('no key update');
  if (!row) throw missing();
  const round = await hydrateRoundRows(tx, roundId);
  if (!round) throw missing();
  const participants: RoundCommandAuthority['participants'] = await Promise.all(
    round.participants.map(async (seat) => {
      if (!actorIds.includes(seat.actorId)) throw createAppError('CONFLICT');
      const actor = await actorFact(tx, seat.actorId);
      return { ...seat, ...seatEligibility(actor, accounts, seat.actorId) };
    }),
  );
  const caller =
    actorId === undefined
      ? null
      : participants.find(
          (seat) =>
            seat.actorId === actorId && seat.kind === 'human' && seat.eligible,
        );
  if (actorId !== undefined && !caller) throw unseatedRefusal();
  return { participants, caller };
}

/** The one refusal a human gets for a Round it holds no live seat in, or that does not exist. */
export const unseatedRefusal = () => createAppError('AUTHORIZATION');

export const mediaWindowClosed = (
  status: string,
  now: string,
  finalEndedAt: string | null,
) =>
  !['scheduled', 'active'].includes(status) ||
  (finalEndedAt !== null &&
    Date.parse(now) >= Date.parse(finalEndedAt) + 30 * 60_000);

export function requireMediaWindow(
  status: string,
  now: string,
  finalEndedAt: string | null,
) {
  if (mediaWindowClosed(status, now, finalEndedAt))
    throw createAppError('CONFLICT', 'Round media has ended');
}
