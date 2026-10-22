import { isDeepStrictEqual } from 'node:util';
import { createAppError } from '@daisy/errors';
import {
  executeLockedRoundBallot,
  type LockedRoundBallotInput,
} from './round-ballot-operations';
import type { BoundedTransactionContext } from './transaction-context';
import {
  assertLockedJudgingLease,
  judgingJobWhere,
  type JudgingScope,
} from './round-judging-context';
import { endLockedRoundAgentRun } from './round-agent-runs';
import { roundJudgingJobs } from './schema/round-judging-jobs';

/** Feature supplies the actual shared ballot preparation. D1 owns lock acquisition order. */
export async function submitLockedJudgingResult(
  tx: BoundedTransactionContext,
  scope: JudgingScope,
  token: string,
  prepared: LockedRoundBallotInput,
) {
  const { envelope, principal } = prepared;
  if (
    prepared.roundId !== scope.roundId ||
    envelope.commandId !== scope.commandId ||
    envelope.judgeParticipantId !== scope.judgeParticipantId ||
    envelope.freezeRevision !== scope.freezeRevision ||
    principal.kind !== 'agent' ||
    principal.agentRunId !== scope.agentRunId ||
    principal.serviceId !== scope.serviceId ||
    principal.participantId !== scope.judgeParticipantId ||
    principal.roundId !== scope.roundId
  )
    throw createAppError('AUTHORIZATION');
  const receipt = await executeLockedRoundBallot(tx, {
    ...prepared,
    assertLease: async (locked, context) => {
      const { job } = await assertLockedJudgingLease(locked, scope, token);
      if (
        context.freezeRevision !== scope.freezeRevision ||
        !job.pendingBallot ||
        !isDeepStrictEqual(job.pendingBallot, envelope.ballot)
      )
        throw createAppError('CONFLICT', 'Judging response not recorded');
    },
  });
  await tx
    .update(roundJudgingJobs)
    .set({
      status: 'succeeded',
      resultBallotId: receipt.ballotId,
      leaseTokenDigest: null,
      leaseExpiresAt: null,
      pendingBallot: null,
      pendingBallotAgentRunId: null,
      pendingBallotEpoch: null,
      pendingBallotReceivedAt: null,
    })
    .where(judgingJobWhere(scope));
  await endLockedRoundAgentRun(tx, scope.agentRunId, scope.judgeParticipantId);
  return receipt;
}
