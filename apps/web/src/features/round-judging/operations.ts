import {
  caseMapAnswer,
  isDefiniteProviderFailure,
  isUnhealableProviderRefusal,
  judgeAnswer,
  type OpenRouter,
} from '@daisy/ai-voice';
import type {
  JudgingStage,
  JudgingAttemptCategory,
  JudgingAttemptDiagnostic,
  JudgingRecoveryReason,
} from '@daisy/protocol';
import type { Database } from '@daisy/db';
import { createAppError } from '@daisy/errors';
import { prepareRoundBallotSubmission } from '../round-ballots/operations';
import { frozenStageRequest } from './prompt';
import type { ProviderCall } from '../../server/provider-budget';

type Store = Pick<
  Database,
  | 'verifyRoundJudgingJob'
  | 'beginRoundJudgingModelCall'
  | 'recordRoundJudgingAttemptFailure'
  | 'recordRoundJudgingUsage'
  | 'saveRoundJudgingResult'
  | 'saveRoundJudgingStage'
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
/** What one attempt left to do. */
type AttemptOutcome = 'ballot_held' | 'concluded';
/** Durable response caching precedes shared submission; attendance rollback never repeats a cached model call. */
export function createRoundJudgingOperations(input: {
  readonly store: Store;
  readonly nextId: () => string;
  readonly voice: () => Pick<OpenRouter, 'complete'>;
  readonly withProvider: ProviderCall;
  readonly recoveryPending?: (reason: JudgingRecoveryReason) => void;
}) {
  return {
    async executeClaim(claim: Claim, signal: AbortSignal) {
      const { scope, token } = claim;
      const verify = () => input.store.verifyRoundJudgingJob(scope, token);
      /** Durable first, then the reason the store returned. */
      const attemptFailed = async (
        diagnostic: JudgingAttemptDiagnostic,
        final: boolean,
      ): Promise<AttemptOutcome> => {
        const deferred = await input.store.recordRoundJudgingAttemptFailure(
          scope,
          token,
          { diagnostic, final },
        );
        if (deferred.kind !== 'retry') input.recoveryPending?.(deferred.reason);
        return 'concluded';
      };
      type Usage = { inputTokens: number; outputTokens: number };
      type Answer = Parameters<typeof judgeAnswer>[0];
      /** A validated answer is stored as its stage's record; anything else is a durable failure. */
      const keepAnswer = async (
        stage: JudgingStage,
        answer: Answer,
        usage: Usage,
      ): Promise<AttemptOutcome> => {
        if (stage === 'map') {
          const mapped = caseMapAnswer(answer);
          if (!mapped.ok) return attemptFailed(mapped.diagnostic, false);
          await input.store.saveRoundJudgingStage(
            scope,
            token,
            { stage, caseMap: mapped.caseMap },
            usage,
          );
          return 'concluded';
        }
        const judged = judgeAnswer(answer);
        if (!judged.ok) return attemptFailed(judged.diagnostic, false);
        if (stage === 'first') {
          await input.store.saveRoundJudgingStage(
            scope,
            token,
            { stage, ballot: judged.ballot },
            usage,
          );
          return 'concluded';
        }
        const saved = await input.store.saveRoundJudgingResult(
          scope,
          token,
          judged.ballot,
          usage,
        );
        return saved.kind === 'held' ? 'ballot_held' : 'concluded';
      };
      /**
       * One provider attempt buys the one stage the job needs (ADR 0125): a
       * final ballot is then held for submission, or an earlier stage's
       * output is stored and the job is due again for the next stage.
       */
      const attempt = async (): Promise<AttemptOutcome> => {
        requireNotCancelled(signal);
        const state = await verify();
        if (state.pendingBallot || !state.stage) return 'ballot_held';
        const { stage } = state;
        const request = frozenStageRequest(claim, stage, state.caseMap);
        const voice = input.voice();
        const begun = await input.store.beginRoundJudgingModelCall(
          scope,
          token,
          stage,
        );
        // This finite window may buy no more calls; durable recovery remains pending.
        if (begun.kind === 'deferred') {
          input.recoveryPending?.(begun.reason);
          return 'concluded';
        }
        let answer: Awaited<ReturnType<typeof voice.complete>>;
        try {
          answer = await voice.complete({
            model: claim.model,
            ...request,
            reasoning: 'medium',
            signal,
          });
        } catch (error) {
          const diagnostic = providerFailure(error, signal);
          // A release, not a failure: this worker no longer holds the lease.
          if (signal.aborted && diagnostic.category !== 'timeout') throw error;
          return attemptFailed(diagnostic, isUnhealableProviderRefusal(error));
        }
        const usage = {
          inputTokens: answer.promptTokens,
          outputTokens: answer.completionTokens,
        };
        await input.store.recordRoundJudgingUsage(scope, token, usage);
        return keepAnswer(stage, answer, usage);
      };
      requireNotCancelled(signal);
      const outcome = (await verify()).pendingBallot
        ? 'ballot_held'
        : await input.withProvider(signal, attempt);
      if (outcome === 'concluded') return null;
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
