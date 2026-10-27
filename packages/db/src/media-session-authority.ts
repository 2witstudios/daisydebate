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
import {
  requireAdmittedPrincipal,
  type ParticipantAdmission,
} from './participant-admission';

/**
 * A human caller and the participant-access rule its own fenced facts must
 * meet (ADR 0075): one cannot be named without the other.
 */
export type MediaCaller = {
  readonly actorId: string;
  readonly admits: ParticipantAdmission;
};

export const mediaId = (value: string) => {
  const parsed = idSchema.safeParse(value);
  if (!parsed.success) throw createAppError('VALIDATION');
  return parsed.data;
};

/**
 * The caller's own eligible human seat, refused unless it holds
 * participant access read after the fence. Seats stay membership-only.
 */
function boundCaller(
  participants: RoundCommandAuthority['participants'],
  accounts: Awaited<ReturnType<typeof lockAuthorizationActors>>,
  mediaCaller: MediaCaller,
) {
  const seat = participants.find(
    (candidate) =>
      candidate.actorId === mediaCaller.actorId &&
      candidate.kind === 'human' &&
      candidate.eligible,
  );
  if (!seat) throw createAppError('AUTHORIZATION');
  requireAdmittedPrincipal(mediaCaller.admits, accounts, mediaCaller.actorId);
  return seat;
}

/** Account fences precede the Round fence, matching competitive writes and erasure. */
export async function lockMediaRound(
  tx: BoundedTransactionContext,
  roundId: string,
  mediaCaller?: MediaCaller,
) {
  const actorId = mediaCaller?.actorId;
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
  if (!initial) throw createAppError('NOT_FOUND');
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
  if (!row) throw createAppError('NOT_FOUND');
  const round = await hydrateRoundRows(tx, roundId);
  if (!round) throw createAppError('NOT_FOUND');
  const participants: RoundCommandAuthority['participants'] = await Promise.all(
    round.participants.map(async (seat) => {
      if (!actorIds.includes(seat.actorId)) throw createAppError('CONFLICT');
      const actor = await actorFact(tx, seat.actorId);
      return { ...seat, ...seatEligibility(actor, accounts, seat.actorId) };
    }),
  );
  const caller = mediaCaller
    ? boundCaller(participants, accounts, mediaCaller)
    : null;
  return { participants, caller };
}

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
