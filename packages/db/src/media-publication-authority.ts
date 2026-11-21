import { instantMs } from '@daisy/clock';
import { eq } from 'drizzle-orm';
import { isRefusal } from '@daisy/errors';
import {
  isAbsentSeat,
  isJudgeSeat,
  type RoundCommandAuthority,
} from '@daisy/protocol';
import type { RoundHydration } from './round-hydration';
import { roundBotPublications } from './schema/round-bot-publications';
import { verifyBotWorkerPrincipalLocked } from './bot-worker-authority';
import { readBotSegmentFloor } from './bot-publication-context';
import type { Tx } from './tx';

type Participants = RoundCommandAuthority['participants'];
type PublicationRound = {
  readonly segments: readonly Pick<RoundHydration['segments'][number], 'id'>[];
  readonly checkpoint: Pick<
    RoundHydration['checkpoint'],
    'absent_participant_ids'
  >;
};
type Publication = {
  readonly participantId: string;
  readonly segmentId: string;
  readonly expiresAt: Date;
  /** The claim holds a speaking window now: it may publish. */
  readonly floor: boolean;
};

/**
 * Each eligible bot seat's live claim within its live segment, and whether
 * it holds the floor. The owning Round fence is already held. Reuses the
 * actual generation scope verifier and the one bot media rule's predicates.
 */
export async function readMediaBotLeases(
  tx: Tx,
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
    (seat) => seat.kind === 'bot' && !isJudgeSeat(seat.seat) && seat.eligible,
  )) {
    const claim = claims.find((claim) => claim.participantId === seat.id);
    if (!claim) continue;
    const target = {
      roundId,
      roundParticipantId: seat.id,
      segmentId: claim.segmentId,
    };
    try {
      await verifyBotWorkerPrincipalLocked(
        tx,
        { kind: 'agent', ...claim },
        roundId,
      );
    } catch (error) {
      // A refused claim simply holds no media fact now.
      if (isRefusal(error)) continue;
      throw error;
    }
    const segment = await readBotSegmentFloor(tx, target);
    if (segment) facts.push({ ...claim, floor: segment.floor });
  }
  return facts;
}

/** A live claim on the current segment that has not expired. */
const liveLease = (
  leases: readonly Publication[],
  seatId: string,
  round: PublicationRound,
  now: string,
) => {
  const segmentId = round.segments.at(-1)?.id;
  return leases.filter(
    (lease) =>
      lease.participantId === seatId &&
      lease.segmentId === segmentId &&
      lease.expiresAt.getTime() > instantMs(now),
  );
};

/** Recheck deadlines against the tick sampled after the final run/claim locks. A bot seat is eligible to publish only while its live claim holds the floor. */
export function mediaPublicationParticipants(
  participants: Participants,
  leases: readonly Publication[],
  round: PublicationRound,
  now: string,
): Participants {
  return participants.map((seat) =>
    seat.kind !== 'bot' || isJudgeSeat(seat.seat)
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
  round: PublicationRound,
  now: string,
) {
  return participants
    .filter(
      (seat) =>
        seat.kind === 'bot' &&
        !isJudgeSeat(seat.seat) &&
        seat.eligible &&
        !isAbsentSeat(round.checkpoint, seat.id) &&
        liveLease(leases, seat.id, round, now).length > 0,
    )
    .map((seat) => seat.id);
}

/**
 * The seats whose media grants are withdrawn in place: those that lost
 * participant access (ISSUE-714) and those that left the Round, which is
 * absent from then on (TAB-6.8). A withdrawn seat is demoted where it is;
 * it never reads as revoked, so leaving never rotates the room under the
 * seats that stay.
 */
export const mediaWithdrawnSeats = (
  revoked: readonly string[],
  round: Pick<PublicationRound, 'checkpoint'>,
): readonly string[] => [
  ...new Set([...revoked, ...(round.checkpoint.absent_participant_ids ?? [])]),
];
