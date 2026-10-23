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

export function requireRequest(request: GenerationRequest) {
  if (!request || !['language', 'tts'].includes(request.kind))
    throw createAppError('VALIDATION');
  if (
    request.kind === 'tts' &&
    (!validCount(request.characters) || request.characters === 0)
  )
    throw createAppError('VALIDATION');
}
export function requireUsage(outcome: Outcome, usage: Usage) {
  if (
    !['received', 'failed', 'unknown'].includes(outcome) ||
    ![usage.inputTokens, usage.outputTokens, usage.characters].every(validCount)
  )
    throw createAppError('VALIDATION');
}
export function requireRunUsage(
  run: typeof agentRuns.$inferSelect,
  usage: Usage,
) {
  if (run.kind === 'tts') {
    if (
      usage.characters !== run.characters ||
      usage.inputTokens !== 0 ||
      usage.outputTokens !== 0
    )
      throw createAppError('VALIDATION');
  } else if (usage.characters !== 0) throw createAppError('VALIDATION');
}
export function requireSameSettlement(
  run: typeof agentRuns.$inferSelect,
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
export function requireSpeechPolicy(policy: SpeechPolicy): string {
  if (
    !policy.ttsModel?.trim() ||
    !policy.speechBudget ||
    !validCount(policy.speechBudget)
  )
    throw createAppError('INFRASTRUCTURE', 'Explicit speech policy required');
  return policy.ttsModel;
}

/** The seat's spoken characters, including this request, stay within budget. */
export function requireSpeechBudget(
  spoken: number,
  characters: number,
  budget: number,
): void {
  if (spoken + characters > budget)
    throw createAppError('CONFLICT', 'Speech budget exhausted');
}

/** A speech request runs as tts; language generation keeps the worker's own kind. */
export const generationRun = (
  request: GenerationRequest,
  workerKind: string,
) =>
  request.kind === 'tts'
    ? { kind: 'tts' as const, characters: request.characters }
    : { kind: workerKind as 'speech' | 'cross_ex', characters: 0 };
