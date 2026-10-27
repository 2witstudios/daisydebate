import {
  parseCoaching,
  roundCoachMessages,
  type OpenRouter,
} from '@daisy/ai-voice';
import type { Database } from '@daisy/db';
import { createAppError } from '@daisy/errors';
import type { ProviderCapacity } from '../round-judging/operations';
import { frozenPromptInput } from '../round-judging/prompt';
import { claimDecision } from './policy';
import { canGenerateCoaching } from './authorization';

type Store = Pick<
  Database,
  | 'claimRoundFeedbackJob'
  | 'recordRoundFeedbackUsage'
  | 'completeRoundFeedbackJob'
>;

/**
 * One paid coaching call per claim (ADR 0071). The coaching policy decides
 * each claim on facts read under the Round's lock. The claim is taken only once
 * the shared provider capacity admits the call, so a busy provider never
 * spends one of the Round's attempts. Usage is recorded whatever the answer
 * held; only a valid answer is stored, and only while the lease holds.
 */
export function createRoundCoachingOperations(input: {
  readonly store: Store;
  readonly betaGrantsPremium: boolean;
  readonly voice: () => Pick<OpenRouter, 'complete'>;
  readonly withProvider: ProviderCapacity;
  /** The decision's clock, read inside each claim. */
  readonly now: () => string;
}) {
  return {
    coach: (roundId: string, signal: AbortSignal) =>
      input.withProvider(signal, async () => {
        if (signal.aborted)
          throw createAppError('CONFLICT', 'Coaching cancelled');
        const claim = await input.store.claimRoundFeedbackJob(
          roundId,
          (facts, access) => {
            if (!canGenerateCoaching(access, input.betaGrantsPremium))
              return facts.pass?.status === 'leased' ? 'fail' : 'skip';
            return claimDecision(facts, input.now());
          },
        );
        if (!claim) return;
        const answer = await input.voice().complete({
          model: claim.model,
          messages: roundCoachMessages(frozenPromptInput(claim)),
          maxTokens: 1500,
          temperature: 0.3,
          json: true,
          reasoning: 'low',
          signal,
        });
        const { id } = claim.round;
        await input.store.recordRoundFeedbackUsage(id, claim.token, {
          inputTokens: answer.promptTokens,
          outputTokens: answer.completionTokens,
        });
        await input.store.completeRoundFeedbackJob(
          id,
          claim.token,
          parseCoaching(answer.text),
        );
      }),
  };
}
