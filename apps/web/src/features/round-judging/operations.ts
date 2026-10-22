import { parseBallot, type OpenRouter } from '@daisy/ai-voice';
import type { Database } from '@daisy/db';
import { createAppError } from '@daisy/errors';
import { prepareRoundBallotSubmission } from '../round-ballots/operations';
import { frozenJudgingMessages } from './prompt';

type Store = Pick<
  Database,
  | 'verifyRoundJudgingJob'
  | 'beginRoundJudgingModelCall'
  | 'recordRoundJudgingUsage'
  | 'saveRoundJudgingResult'
  | 'submitRoundJudgingResult'
>;
type Claim = Awaited<ReturnType<Database['claimRoundJudgingJob']>>;
export type ProviderCapacity = <T>(
  signal: AbortSignal,
  work: () => Promise<T>,
) => Promise<T>;
function requireNotCancelled(signal: AbortSignal) {
  if (signal.aborted) throw createAppError('CONFLICT', 'Judging cancelled');
}
/** Durable response caching precedes shared submission; attendance rollback never repeats a cached model call. */
export function createRoundJudgingOperations(input: {
  readonly store: Store;
  readonly nextId: () => string;
  readonly voice: () => Pick<OpenRouter, 'complete'>;
  readonly withProvider: ProviderCapacity;
}) {
  return {
    async executeClaim(claim: Claim, signal: AbortSignal) {
      const { scope, token } = claim;
      const verify = () => input.store.verifyRoundJudgingJob(scope, token);
      requireNotCancelled(signal);
      if (!(await verify()).pendingBallot) {
        await input.withProvider(signal, async () => {
          requireNotCancelled(signal);
          if ((await verify()).pendingBallot) return;
          const messages = frozenJudgingMessages(claim);
          const voice = input.voice();
          await input.store.beginRoundJudgingModelCall(scope, token);
          const answer = await voice.complete({
            model: claim.model,
            messages,
            maxTokens: 6000,
            temperature: 0.2,
            json: true,
            reasoning: 'medium',
            signal,
          });
          const usage = {
            inputTokens: answer.promptTokens,
            outputTokens: answer.completionTokens,
          };
          await input.store.recordRoundJudgingUsage(scope, token, usage);
          await input.store.saveRoundJudgingResult(
            scope,
            token,
            parseBallot(answer.text),
            usage,
          );
        });
      }
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
