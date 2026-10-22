import { and, eq } from 'drizzle-orm';
import type { RoundCommandPrincipal } from '@daisy/protocol';
import type { RoundHydration } from './round-hydration';
import type { RoundWriteTransaction } from './round-write-authority';
import { roundBotPublications } from './schema/round-bot-publications';

type Claim = typeof roundBotPublications.$inferSelect;
export async function lockRoundCommandWorker(
  tx: RoundWriteTransaction,
  principal: RoundCommandPrincipal,
) {
  if (principal.kind !== 'agent') return null;
  const [claim] = await tx
    .select()
    .from(roundBotPublications)
    .where(
      and(
        eq(roundBotPublications.roundId, principal.roundId),
        eq(roundBotPublications.roundParticipantId, principal.participantId),
      ),
    )
    .for('share');
  return claim ?? null;
}
/** A private service principal still needs its current durable epoch and post-lock lease. */
export function roundCommandWorkerActive(input: {
  readonly principal: RoundCommandPrincipal;
  readonly claim: Claim | null;
  readonly kind: string | null;
  readonly configuration: Record<string, unknown> | null;
  readonly round: RoundHydration;
  readonly now: string;
}): boolean {
  const { principal, claim, configuration, kind, round, now } = input;
  if (principal.kind !== 'agent' || !claim || !configuration) return false;
  if (kind !== 'speech' && kind !== 'cross_ex') return false;
  const expected = {
    roundId: round.id,
    roundParticipantId: principal.participantId,
    segmentId: claim.segmentId,
    serviceId: principal.serviceId,
    publicationEpoch: claim.publicationEpoch,
  };
  if (
    Object.entries(expected).some(
      ([key, value]) => configuration[key] !== value,
    )
  )
    return false;
  if (!currentLease(claim, principal, now)) return false;
  return (
    round.status !== 'active' ||
    currentWorkerSegment(round, claim.segmentId, now)
  );
}
function currentWorkerSegment(
  round: RoundHydration,
  segmentId: string,
  now: string,
): boolean {
  const segment = round.segments.at(-1);
  if (!segment || segment.id !== segmentId || segment.endedAt !== null)
    return false;
  const at = Date.parse(now),
    start = Date.parse(segment.startedAt);
  return at >= start && at < start + segment.durationMs;
}

function currentLease(
  claim: Claim,
  principal: Extract<RoundCommandPrincipal, { kind: 'agent' }>,
  now: string,
): boolean {
  if (
    claim.agentRunId !== principal.agentRunId ||
    claim.serviceId !== `agent-run:${principal.agentRunId}` ||
    claim.serviceId !== principal.serviceId ||
    claim.leaseExpiresAt.getTime() <= Date.parse(now)
  )
    return false;
  return true;
}
