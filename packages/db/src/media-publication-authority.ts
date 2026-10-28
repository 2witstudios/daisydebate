import { eq } from 'drizzle-orm';
import { isAppError } from '@daisy/errors';
import type { RoundCommandAuthority } from '@daisy/protocol';
import type { BoundedTransactionContext } from './transaction-context';
import type { RoundHydration } from './round-hydration';
import { roundBotPublications } from './schema/round-bot-publications';
import { verifyBotWorkerPrincipalLocked } from './bot-worker-authority';
import {
  requireBotSegmentLive,
  requireBotSpeakingWindow,
} from './bot-publication-context';

type Participants = RoundCommandAuthority['participants'];
type Publication = {
  readonly participantId: string;
  readonly segmentId: string;
  readonly expiresAt: Date;
  /** The claim holds a speaking window now: it may publish. */
  readonly floor: boolean;
};

/** An admission refusal: the seat simply holds no such media fact now. */
const refused = (error: unknown) =>
  isAppError(error) && ['CONFLICT', 'AUTHORIZATION'].includes(error.code);
/** Whether `check` admits, a refusal reading as false. */
const admits = async (check: () => Promise<void>) => {
  try {
    await check();
    return true;
  } catch (error) {
    if (refused(error)) return false;
    throw error;
  }
};

/**
 * Each eligible bot seat's live claim within its live segment, and whether
 * it holds the floor. The owning Round fence is already held. Reuses the
 * actual generation scope verifier and the one bot media rule's predicates.
 */
export async function readMediaBotLeases(
  tx: BoundedTransactionContext,
  roundId: string,
  participants: Participants,
) {
  const facts: Publication[] = [];
  const claims = await tx
    .select({
      participantId: roundBotPublications.roundParticipantId,
      agentRunId: roundBotPublications.agentRunId,
      segmentId: roundBotPublications.segmentId,
      serviceId: roundBotPublications.serviceId,
      publicationEpoch: roundBotPublications.publicationEpoch,
      expiresAt: roundBotPublications.leaseExpiresAt,
    })
    .from(roundBotPublications)
    .where(eq(roundBotPublications.roundId, roundId));
  for (const seat of participants.filter(
    (seat) => seat.kind === 'bot' && seat.role !== 'judge' && seat.eligible,
  )) {
    const claim = claims.find((claim) => claim.participantId === seat.id);
    if (!claim) continue;
    const target = {
      roundId,
      roundParticipantId: seat.id,
      segmentId: claim.segmentId,
    };
    const live = await admits(async () => {
      await verifyBotWorkerPrincipalLocked(
        tx,
        { kind: 'agent', ...claim },
        roundId,
      );
      await requireBotSegmentLive(tx, target);
    });
    if (!live) continue;
    const floor = await admits(() => requireBotSpeakingWindow(tx, target));
    facts.push({ ...claim, floor });
  }
  return facts;
}

/** A live claim on the current segment that has not expired. */
const liveLease = (
  leases: readonly Publication[],
  seatId: string,
  round: RoundHydration,
  now: string,
) => {
  const segmentId = round.segments.at(-1)?.id;
  return leases.filter(
    (lease) =>
      lease.participantId === seatId &&
      lease.segmentId === segmentId &&
      lease.expiresAt.getTime() > Date.parse(now),
  );
};

/** Recheck deadlines against the tick sampled after the final run/claim locks. A bot seat is eligible to publish only while its live claim holds the floor. */
export function mediaPublicationParticipants(
  participants: Participants,
  leases: readonly Publication[],
  round: RoundHydration,
  now: string,
): Participants {
  return participants.map((seat) =>
    seat.kind !== 'bot' || seat.role === 'judge'
      ? seat
      : {
          ...seat,
          eligible:
            seat.eligible &&
            liveLease(leases, seat.id, round, now).some((lease) => lease.floor),
        },
  );
}

/**
 * Bot seats that may hear (ISSUE-764): eligible seats whose live claim is
 * within its live segment, with or without the floor. Recheck deadlines
 * against the same post-lock tick.
 */
export function mediaHearingSeats(
  participants: Participants,
  leases: readonly Publication[],
  round: RoundHydration,
  now: string,
) {
  return participants
    .filter(
      (seat) =>
        seat.kind === 'bot' &&
        seat.role !== 'judge' &&
        seat.eligible &&
        liveLease(leases, seat.id, round, now).length > 0,
    )
    .map((seat) => seat.id);
}
