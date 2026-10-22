import type { Database } from '@daisy/db';
import type { createAttendanceFeature } from '../attendance/operations';
type Claim = Awaited<ReturnType<Database['claimRoundBotWorker']>>;
/** Control receipts depend on the fresh worker lease, never publication, floor, model or media. */
export function createBotControl(input: {
  readonly claim: Claim;
  readonly store: Pick<Database, 'renewRoundBotWorker'>;
  readonly attendance: Pick<
    ReturnType<typeof createAttendanceFeature>,
    'targets' | 'checkIn'
  >;
  readonly nextId: () => string;
}) {
  const { scope, token } = input.claim;
  const principal = {
    kind: 'agent' as const,
    serviceId: scope.serviceId,
    agentRunId: scope.agentRunId,
    participantId: scope.roundParticipantId,
    publicationEpoch: scope.publicationEpoch,
  };
  const pulse = async () => {
    await input.store.renewRoundBotWorker(scope, token);
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
