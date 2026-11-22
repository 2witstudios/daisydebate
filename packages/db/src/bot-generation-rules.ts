import { z } from 'zod';
import { createAppError } from '@daisy/errors';
import { validAgentCounter } from './agent-accounting';
import type { agentRuns } from './schema/agent-runs';

export type GenerationRequest =
  | { readonly kind: 'language' }
  | { readonly kind: 'tts'; readonly characters: number };
export type Execution = { readonly id: string; readonly token: string };
export type Usage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly characters: number;
};
export type Outcome = 'received' | 'failed' | 'unknown';
const validCount = validAgentCounter;

const finalRefusals = new WeakSet<Error>();
/**
 * A bot speech refusal no retry can clear: this seat's voice budget is spent,
 * or its answer for this segment was already received. The speaker stops.
 */
export const isFinalBotSpeechRefusal = (error: unknown): boolean =>
  error instanceof Error && finalRefusals.has(error);
export function refuseFinalSpeech(message: string) {
  const refusal = createAppError('CONFLICT', message);
  finalRefusals.add(refusal);
  return refusal;
}

const generationRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('language') }),
  z.object({
    kind: z.literal('tts'),
    characters: z.number().min(1).refine(validCount),
  }),
]);

export function requireRequest(request: unknown) {
  if (!generationRequestSchema.safeParse(request).success)
    throw createAppError('VALIDATION');
}
export function requireUsage(outcome: Outcome, usage: Usage) {
  if (
    !['received', 'failed', 'unknown'].includes(outcome) ||
    ![usage.inputTokens, usage.outputTokens, usage.characters].every(validCount)
  )
    throw createAppError('VALIDATION');
}
/** A definitely failed call served nothing, so it settles with no usage. */
export function requireRunUsage(
  run: Pick<typeof agentRuns.$inferSelect, 'kind' | 'characters'>,
  outcome: Outcome,
  usage: Usage,
) {
  if (outcome === 'failed') {
    if (usage.inputTokens || usage.outputTokens || usage.characters)
      throw createAppError('VALIDATION');
  } else if (run.kind === 'tts') {
    if (
      usage.characters !== run.characters ||
      usage.inputTokens !== 0 ||
      usage.outputTokens !== 0
    )
      throw createAppError('VALIDATION');
  } else if (usage.characters !== 0) throw createAppError('VALIDATION');
}
export function requireSameSettlement(
  run: Pick<
    typeof agentRuns.$inferSelect,
    'characters' | 'inputTokens' | 'outputTokens'
  > & {
    readonly configurationSnapshot: { readonly providerOutcome?: Outcome };
  },
  outcome: Outcome,
  usage: Usage,
) {
  if (
    run.configurationSnapshot.providerOutcome !== outcome ||
    run.inputTokens !== usage.inputTokens ||
    run.outputTokens !== usage.outputTokens ||
    run.characters !== usage.characters
  )
    throw createAppError('CONFLICT');
}
export type SpeechPolicy = {
  readonly ttsModel?: string;
  readonly speechBudget?: number;
};

/** Speech needs an explicit model and a positive per-seat character budget. */
export function requireSpeechPolicy(policy: SpeechPolicy) {
  if (
    !policy.ttsModel?.trim() ||
    !policy.speechBudget ||
    !validCount(policy.speechBudget)
  )
    throw createAppError('INFRASTRUCTURE', 'Explicit speech policy required');
  return { model: policy.ttsModel, budget: policy.speechBudget };
}

/** A speech request runs as tts; language generation keeps the worker's own kind. */
export const generationRun = (
  request: GenerationRequest,
  workerKind: string,
) =>
  request.kind === 'tts'
    ? { kind: 'tts' as const, characters: request.characters }
    : { kind: workerKind as 'speech' | 'cross_ex', characters: 0 };
