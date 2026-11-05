import {
  isDefiniteProviderFailure,
  parseRoundAnalysis,
  roundAnalysisMessages,
  type OpenRouter,
} from '@daisy/ai-voice';
import type { Database } from '@daisy/db';
import type { RoundAnalysisSeat } from '@daisy/db/rounds';
import { createAppError } from '@daisy/errors';
import type { ProviderCall } from '../../server/provider-budget';
import { transcriptEvidenceInput } from '../round-runtime/transcript-evidence';

const analysisMaxTokens = 12_000;
type Store = Pick<
  Database,
  | 'claimRoundAnalysisJob'
  | 'beginRoundAnalysisModelCall'
  | 'recordRoundAnalysisOutcome'
  | 'completeRoundAnalysisJob'
  | 'retryRoundAnalysisJob'
>;
const requireRunning = (signal: AbortSignal) => {
  if (signal.aborted)
    throw createAppError('CONFLICT', 'Round analysis cancelled');
};

/** Claim/preparation is uncounted. Fresh durable dispatch authority precedes one provider call. */
export function createRoundAnalysisOperations(input: {
  readonly store: Store;
  readonly voice: () => Pick<OpenRouter, 'complete'>;
  readonly withProvider: ProviderCall;
}) {
  return {
    analyse: (seat: RoundAnalysisSeat, signal: AbortSignal) =>
      input.withProvider(signal, async () => {
        requireRunning(signal);
        const claim = await input.store.claimRoundAnalysisJob(seat);
        if (!claim) return;
        const retry = () =>
          input.store.retryRoundAnalysisJob(seat, claim.callId, claim.token);
        let evidence: ReturnType<typeof transcriptEvidenceInput>;
        let messages: ReturnType<typeof roundAnalysisMessages>;
        let voice: Pick<OpenRouter, 'complete'>;
        try {
          requireRunning(signal);
          evidence = transcriptEvidenceInput(claim);
          messages = roundAnalysisMessages({
            evidence,
            seat: claim.seat,
            history: claim.history,
          });
          voice = input.voice();
        } catch (error) {
          await retry();
          throw error;
        }
        const begun = await input.store.beginRoundAnalysisModelCall(
          seat,
          claim.callId,
          claim.token,
        );
        if (!begun) return;
        let answer: Awaited<ReturnType<typeof voice.complete>>;
        try {
          answer = await voice.complete({
            model: claim.model,
            messages,
            maxTokens: analysisMaxTokens,
            temperature: 0.3,
            json: true,
            reasoning: 'low',
            signal,
          });
        } catch (error) {
          if (isDefiniteProviderFailure(error))
            await input.store.recordRoundAnalysisOutcome(
              seat,
              claim.callId,
              claim.token,
              { kind: 'definite_failure' },
            );
          await retry();
          throw error;
        }
        await input.store.recordRoundAnalysisOutcome(
          seat,
          claim.callId,
          claim.token,
          {
            kind: 'received',
            inputTokens: answer.promptTokens,
            outputTokens: answer.completionTokens,
          },
        );
        try {
          await input.store.completeRoundAnalysisJob(
            seat,
            claim.callId,
            claim.token,
            parseRoundAnalysis(answer.text, {
              evidence,
              history: claim.history,
            }),
          );
        } catch (error) {
          await retry();
          throw error;
        }
      }),
  };
}
