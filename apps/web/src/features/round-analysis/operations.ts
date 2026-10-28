import {
  parseRoundAnalysis,
  roundAnalysisMessages,
  type OpenRouter,
} from '@daisy/ai-voice';
import type { Database } from '@daisy/db';
import type { RoundAnalysisSeat } from '@daisy/db/rounds';
import { createAppError } from '@daisy/errors';
import type { ProviderCall } from '../../server/provider-budget';
import { transcriptEvidenceInput } from '../round-runtime/transcript-evidence';
import { canUseRoundAnalysis } from './authorization';
import { roundAnalysisClaimDecision } from './policy';

/**
 * Output room for a report at every limit (about 11k characters, under 3k
 * tokens, before JSON keys) plus the reasoning the provider carves out of
 * the same budget, so a long valid report is never cut off mid-JSON.
 */
const analysisMaxTokens = 12_000;

type Store = Pick<
  Database,
  | 'claimRoundAnalysisJob'
  | 'recordRoundAnalysisUsage'
  | 'completeRoundAnalysisJob'
>;

/**
 * One paid analysis call per claim. The round-analysis policy decides each
 * claim on facts read under the Round's lock, and only for a seat whose
 * debater holds the entitlement. The claim is taken only once round
 * analysis's own provider budget admits the call, so a busy provider never
 * spends an attempt. Usage is recorded whatever the answer held; only a
 * valid report is stored, and only while the lease holds.
 */
export function createRoundAnalysisOperations(input: {
  readonly store: Store;
  readonly betaGrantsPremium: boolean;
  readonly voice: () => Pick<OpenRouter, 'complete'>;
  readonly withProvider: ProviderCall;
  /** The decision's clock, read inside each claim. */
  readonly now: () => string;
}) {
  return {
    analyse: (seat: RoundAnalysisSeat, signal: AbortSignal) =>
      input.withProvider(signal, async () => {
        if (signal.aborted)
          throw createAppError('CONFLICT', 'Round analysis cancelled');
        const claim = await input.store.claimRoundAnalysisJob(
          seat,
          (facts, access) => {
            if (
              !canUseRoundAnalysis(
                access,
                input.betaGrantsPremium,
                'round.analysis.generate',
              )
            )
              return facts.analysis?.status === 'leased' ? 'fail' : 'skip';
            return roundAnalysisClaimDecision(facts, input.now());
          },
        );
        if (!claim) return;
        const evidence = transcriptEvidenceInput(claim);
        const answer = await input.voice().complete({
          model: claim.model,
          messages: roundAnalysisMessages({
            evidence,
            seat: claim.seat,
            history: claim.history,
          }),
          maxTokens: analysisMaxTokens,
          temperature: 0.3,
          json: true,
          reasoning: 'low',
          signal,
        });
        await input.store.recordRoundAnalysisUsage(seat, claim.token, {
          inputTokens: answer.promptTokens,
          outputTokens: answer.completionTokens,
        });
        await input.store.completeRoundAnalysisJob(
          seat,
          claim.token,
          parseRoundAnalysis(answer.text, { evidence, history: claim.history }),
        );
      }),
  };
}
