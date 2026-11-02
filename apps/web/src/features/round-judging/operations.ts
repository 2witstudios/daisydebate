import {
  ballotWireSchema,
  isDefiniteProviderFailure,
  isUnhealableProviderRefusal,
  judgeAnswer,
  judgeContractVersion,
  type OpenRouter,
} from '@daisy/ai-voice';
import type {
  JudgingAttemptCategory,
  JudgingAttemptDiagnostic,
} from '@daisy/protocol';
import type { Database } from '@daisy/db';
import { createAppError } from '@daisy/errors';
import { prepareRoundBallotSubmission } from '../round-ballots/operations';
import { frozenJudgingMessages } from './prompt';
import type { ProviderCall } from '../../server/provider-budget';

type Store = Pick<
  Database,
  | 'verifyRoundJudgingJob'
  | 'beginRoundJudgingModelCall'
  | 'recordRoundJudgingAttemptFailure'
  | 'recordRoundJudgingUsage'
  | 'saveRoundJudgingResult'
  | 'submitRoundJudgingResult'
>;
type Claim = Awaited<ReturnType<Database['claimRoundJudgingJob']>>;
function requireNotCancelled(signal: AbortSignal) {
  if (signal.aborted) throw createAppError('CONFLICT', 'Judging cancelled');
}
/** The provider call failed: what can be said without any provider text. */
const providerFailure = (
  error: unknown,
  signal: AbortSignal,
): JudgingAttemptDiagnostic => {
  const category: JudgingAttemptCategory = isDefiniteProviderFailure(error)
    ? 'provider_refused'
    : signal.reason instanceof DOMException &&
        signal.reason.name === 'TimeoutError'
      ? 'timeout'
      : 'provider_error';
  return { category, finish: 'none', issueCount: 0, issues: [] };
};
/** Durable response caching precedes shared submission; attendance rollback never repeats a cached model call. */
export function createRoundJudgingOperations(input: {
  readonly store: Store;
  readonly nextId: () => string;
  readonly voice: () => Pick<OpenRouter, 'complete'>;
  readonly withProvider: ProviderCall;
  /** Once, when a job ends with no ballot. Holds only a closed reason. */
  readonly jobEnded?: (
    reason: JudgingAttemptCategory | 'out_of_budget',
  ) => void;
}) {
  return {
    async executeClaim(claim: Claim, signal: AbortSignal) {
      const { scope, token } = claim;
      const verify = () => input.store.verifyRoundJudgingJob(scope, token);
      /** Durable first; true means this attempt has nothing further to do. */
      const attemptFailed = async (
        diagnostic: JudgingAttemptDiagnostic,
        definite: boolean,
        final: boolean,
      ) => {
        const next = await input.store.recordRoundJudgingAttemptFailure(
          scope,
          token,
          {
            diagnostic,
            contractVersion: judgeContractVersion,
            definite,
            final,
          },
        );
        if (next !== 'retry') input.jobEnded?.(diagnostic.category);
      };
      let concluded = false;
      requireNotCancelled(signal);
      if (!(await verify()).pendingBallot) {
        await input.withProvider(signal, async () => {
          requireNotCancelled(signal);
          if ((await verify()).pendingBallot) return;
          const messages = frozenJudgingMessages(claim);
          const voice = input.voice();
          // The job may buy no more calls: it has ended failed (ISSUE-461).
          if (!(await input.store.beginRoundJudgingModelCall(scope, token))) {
            input.jobEnded?.('out_of_budget');
            concluded = true;
            return;
          }
          let answer: Awaited<ReturnType<typeof voice.complete>>;
          try {
            answer = await voice.complete({
              model: claim.model,
              messages,
              maxTokens: 6000,
              outputSchema: { name: 'ballot', schema: ballotWireSchema },
              reasoning: 'medium',
              signal,
            });
          } catch (error) {
            const diagnostic = providerFailure(error, signal);
            // A release, not a failure: this worker no longer holds the lease.
            if (signal.aborted && diagnostic.category !== 'timeout')
              throw error;
            const refused = diagnostic.category === 'provider_refused';
            await attemptFailed(
              diagnostic,
              refused,
              isUnhealableProviderRefusal(error),
            );
            concluded = true;
            return;
          }
          const usage = {
            inputTokens: answer.promptTokens,
            outputTokens: answer.completionTokens,
          };
          await input.store.recordRoundJudgingUsage(scope, token, usage);
          const judged = judgeAnswer(answer);
          if (!judged.ok) {
            await attemptFailed(judged.diagnostic, false, false);
            concluded = true;
            return;
          }
          const held = await input.store.saveRoundJudgingResult(
            scope,
            token,
            judged.ballot,
            usage,
          );
          if (!held) {
            input.jobEnded?.('out_of_budget');
            concluded = true;
          }
        });
      }
      if (concluded) return null;
      requireNotCancelled(signal);
      const fresh = await verify();
      if (!fresh.pendingBallot)
        throw createAppError('CONFLICT', 'Judging response unavailable');
      const prepared = prepareRoundBallotSubmission({
        principal: {
          kind: 'agent',
          serviceId: scope.serviceId,
          agentRunId: scope.agentRunId,
          roundId: scope.roundId,
          participantId: scope.judgeParticipantId,
        },
        roundId: scope.roundId,
        envelope: {
          version: 1,
          commandId: scope.commandId,
          expectedVersion: fresh.expectedVersion,
          judgeParticipantId: scope.judgeParticipantId,
          freezeRevision: scope.freezeRevision,
          ballot: fresh.pendingBallot,
        },
        nextBallotId: input.nextId,
        nextSegmentId: input.nextId,
      });
      requireNotCancelled(signal);
      return input.store.submitRoundJudgingResult(scope, token, prepared);
    },
  };
}
