import { type RoundWorkerStore } from '@daisy/db/stores/round-workers';
import type { createAttendanceFeature } from '../attendance/operations';
type Claim = Awaited<ReturnType<RoundWorkerStore['claimRoundBotWorker']>>;
/**
 * A seat's attendance receipts. They rest on the worker lease, which the
 * control service renews on its own cadence, never on publication, floor,
 * model or media.
 */
export function createBotControl(input: {
  readonly claim: Claim;
  readonly attendance: Pick<
    ReturnType<typeof createAttendanceFeature>,
    'targets' | 'checkIn'
  >;
  readonly nextId: () => string;
}) {
  const { scope } = input.claim;
  const principal = {
    kind: 'agent' as const,
    serviceId: scope.serviceId,
    agentRunId: scope.agentRunId,
    participantId: scope.roundParticipantId,
    publicationEpoch: scope.publicationEpoch,
  };
  const pulse = async () => {
    const targets = await input.attendance.targets(principal, scope.roundId);
    const receipts = [];
    for (const target of targets)
      receipts.push(
        await input.attendance.checkIn(principal, scope.roundId, {
          version: 1,
          commandId: input.nextId(),
          segmentId: target.segmentId,
        }),
      );
    return receipts;
  };
  let pending: ReturnType<typeof pulse> | null = null;
  return {
    pulse: () => {
      pending ??= pulse().finally(() => {
        pending = null;
      });
      return pending;
    },
  };
}
