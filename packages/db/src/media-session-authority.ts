import { createAppError } from '@daisy/errors';
import {
  idSchema,
  type MediaPhase,
  type MediaWindowFacts,
  type RoundCommandAuthority,
} from '@daisy/protocol';
import { eq } from 'drizzle-orm';
import { lockAuthorizationActors } from './authorization';
import type { BoundedTransactionContext } from './transaction-context';
import { actorFact } from './room-command-facts';
import { hydrateRoundRows } from './round-hydration';
import { rounds } from './schema/rounds';
import { mediaSessions } from './schema/media-sessions';
import { roundParticipants } from './schema/round-participants';
import { requireFencedParticipants } from './round-command-replay';
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
  if (!seat) throw unseatedRefusal();
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
  // The Round first: a launch commits it with its seats, so seats read after a
  // visible Round are all of them, and no launch can land between (ISSUE-1186).
  const [initial] = await tx
    .select({ hostActorId: rounds.createdByActorId })
    .from(rounds)
    .where(eq(rounds.id, roundId));
  // A human gets the unseated refusal for a missing Round: no existence oracle.
  const missing = () =>
    actorId === undefined ? createAppError('NOT_FOUND') : unseatedRefusal();
  if (!initial) throw missing();
  const seats = await tx
    .select({ actorId: roundParticipants.actorId })
    .from(roundParticipants)
    .where(eq(roundParticipants.roundId, roundId));
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
  requireFencedParticipants(round.participants, actorIds);
  const participants: RoundCommandAuthority['participants'] = await Promise.all(
    round.participants.map(async (seat) => {
      const actor = await actorFact(tx, seat.actorId);
      return { ...seat, ...seatEligibility(actor, accounts, seat) };
    }),
  );
  const caller = mediaCaller
    ? boundCaller(participants, accounts, mediaCaller)
    : null;
  return { participants, caller, accounts };
}

/** The one refusal a human gets for a Round it holds no live seat in, or that does not exist. */
export const unseatedRefusal = () => createAppError('AUTHORIZATION');

/** The engine's decision (`mediaPhase`); the adapter only applies it. */
export type MediaWindowRule = (facts: MediaWindowFacts) => MediaPhase;

/**
 * The facts the media window is decided from, read from the Round and its
 * session at `at.now`. A tick's own final segment end, when given, is newer
 * than the row's.
 */
export async function readMediaWindowFacts(
  tx: BoundedTransactionContext,
  roundId: string,
  at: {
    readonly now: string;
    readonly finalSegmentEndedAt?: string | null;
  },
): Promise<MediaWindowFacts> {
  const [row] = await tx
    .select({
      status: rounds.status,
      finalSegmentEndedAt: rounds.finalSegmentEndedAt,
      completedAt: rounds.completedAt,
      postRoundCall: rounds.postRoundCall,
      openedAt: mediaSessions.postRoundCallOpenedAt,
      vacantSince: mediaSessions.roomVacantSince,
    })
    .from(rounds)
    .leftJoin(mediaSessions, eq(mediaSessions.roundId, rounds.id))
    .where(eq(rounds.id, roundId));
  if (!row) throw createAppError('NOT_FOUND');
  return {
    status: row.status,
    now: at.now,
    finalSegmentEndedAt:
      at.finalSegmentEndedAt !== undefined
        ? at.finalSegmentEndedAt
        : (row.finalSegmentEndedAt?.toISOString() ?? null),
    postRoundCall: {
      optedIn: row.postRoundCall,
      status: row.status,
      roundEndedAt: row.completedAt?.toISOString() ?? null,
      openedAt: row.openedAt?.toISOString() ?? null,
      vacantSince: row.vacantSince?.toISOString() ?? null,
    },
  };
}

/**
 * Admission needs open media. While a post-round call is opening, the Round's
 * room is still being proven gone, so the answer is to ask again (ADR 0126).
 */
export function requireMediaWindow(
  phaseOf: MediaWindowRule,
  facts: MediaWindowFacts,
) {
  const phase = phaseOf(facts);
  if (phase === 'closed')
    throw createAppError('CONFLICT', 'Round media has ended');
  if (phase === 'post-round-call-opening')
    throw createAppError('INFRASTRUCTURE', 'Media recovery is unresolved');
  return phase;
}
