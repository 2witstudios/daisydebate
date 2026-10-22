import { eq } from 'drizzle-orm';
import { isAppError } from '@daisy/errors';
import type { RoundCommandAuthority } from '@daisy/protocol';
import type { BoundedTransactionContext } from './transaction-context';
import type { RoundHydration } from './round-hydration';
import { roundBotPublications } from './schema/round-bot-publications';
import { verifyBotWorkerPrincipalLocked } from './bot-worker-authority';
import { requireBotSpeakingWindow } from './bot-publication-context';

type Participants = RoundCommandAuthority['participants'];
type Publication = {
  readonly participantId: string;
  readonly segmentId: string;
  readonly expiresAt: Date;
};

/** The owning Round fence is already held. Reuse the actual generation scope verifier. */
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
    try {
      await verifyBotWorkerPrincipalLocked(
        tx,
        { kind: 'agent', ...claim },
        roundId,
      );
      await requireBotSpeakingWindow(tx, {
        roundId,
        roundParticipantId: seat.id,
        segmentId: claim.segmentId,
      });
      facts.push(claim);
    } catch (error) {
      if (
        !isAppError(error) ||
        !['CONFLICT', 'AUTHORIZATION'].includes(error.code)
      )
        throw error;
    }
  }
  return facts;
}

/** Recheck deadlines against the tick sampled after the final run/claim locks. */
export function mediaPublicationParticipants(
  participants: Participants,
  leases: readonly Publication[],
  round: RoundHydration,
  now: string,
): Participants {
  const segmentId = round.segments.at(-1)?.id;
  return participants.map((seat) =>
    seat.kind !== 'bot' || seat.role === 'judge'
      ? seat
      : {
          ...seat,
          eligible:
            seat.eligible &&
            leases.some(
              (lease) =>
                lease.participantId === seat.id &&
                lease.segmentId === segmentId &&
                lease.expiresAt.getTime() > Date.parse(now),
            ),
        },
  );
}
