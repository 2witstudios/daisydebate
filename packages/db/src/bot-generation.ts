import { and, eq, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type { BoundedTransactionContext } from './transaction-context';
import type { BoundedTransaction } from './bounded-transaction';
import { agentLeaseDigest } from './round-agent-lease';
import { lockAgentAccounting, validAgentCounter } from './agent-accounting';
import { startLockedRoundAgentRun } from './round-agent-runs';
import {
  lockBotAdmission,
  markLockedRoundBotModelCall,
} from './round-bot-admission';
import {
  requireBotSpeakingWindow,
  verifyLockedBotWorker,
  type BotPublicationScope,
} from './bot-publication-context';
import { agentRuns } from './schema/agent-runs';
import { botProfiles } from './schema/bot-profiles';
import { readOrderedRoundUtterances } from './round-utterance-projection';

type GenerationRequest =
  | { readonly kind: 'language' }
  | { readonly kind: 'tts'; readonly characters: number };
type Execution = { readonly id: string; readonly token: string };
type Usage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly characters: number;
};
type Outcome = 'received' | 'failed' | 'unknown';
const validCount = validAgentCounter;

function requireRequest(request: GenerationRequest) {
  if (!request || !['language', 'tts'].includes(request.kind))
    throw createAppError('VALIDATION');
  if (
    request.kind === 'tts' &&
    (!validCount(request.characters) || request.characters === 0)
  )
    throw createAppError('VALIDATION');
}
function requireUsage(outcome: Outcome, usage: Usage) {
  if (
    !['received', 'failed', 'unknown'].includes(outcome) ||
    ![usage.inputTokens, usage.outputTokens, usage.characters].every(validCount)
  )
    throw createAppError('VALIDATION');
}
function requireRunUsage(run: typeof agentRuns.$inferSelect, usage: Usage) {
  if (run.kind === 'tts') {
    if (
      usage.characters !== run.characters ||
      usage.inputTokens !== 0 ||
      usage.outputTokens !== 0
    )
      throw createAppError('VALIDATION');
  } else if (usage.characters !== 0) throw createAppError('VALIDATION');
}
function requireSameSettlement(
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
type SpeechPolicy = {
  readonly ttsModel?: string;
  readonly speechBudget?: number;
};
async function speechModel(
  tx: BoundedTransactionContext,
  scope: BotPublicationScope,
  characters: number,
  policy: SpeechPolicy,
) {
  if (
    !policy.ttsModel?.trim() ||
    !policy.speechBudget ||
    !validCount(policy.speechBudget)
  )
    throw createAppError('INFRASTRUCTURE', 'Explicit speech policy required');
  const [total] = await tx
    .select({
      characters: sql<number>`coalesce(sum(${agentRuns.characters}),0)`,
    })
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.roundParticipantId, scope.roundParticipantId),
        eq(agentRuns.kind, 'tts'),
      ),
    );
  if (Number(total?.characters ?? 0) + characters > policy.speechBudget)
    throw createAppError('CONFLICT', 'Speech budget exhausted');
  return policy.ttsModel;
}
/** Dispatch authority and usage settlement are distinct capabilities; neither writes speech. */
export function createBotGenerationOperations(input: {
  readonly run: BoundedTransaction;
  readonly nextId: () => string;
  readonly nextToken: () => string;
  readonly ttsModel?: string;
  readonly speechBudget?: number;
}) {
  return {
    beginGeneration: (
      scope: BotPublicationScope,
      token: string,
      request: GenerationRequest,
    ) =>
      input.run(async (tx) => {
        requireRequest(request);
        await lockBotAdmission(tx);
        const context = await verifyLockedBotWorker(tx, scope, token);
        await requireBotSpeakingWindow(tx, scope);
        const [profile] = await tx
          .select()
          .from(botProfiles)
          .where(eq(botProfiles.actorId, context.seat.actorId));
        if (!profile) throw createAppError('AUTHORIZATION');
        const model =
          request.kind === 'tts'
            ? await speechModel(tx, scope, request.characters, input)
            : context.run.model;
        if (!model?.trim()) throw createAppError('INFRASTRUCTURE');
        const history = await readOrderedRoundUtterances(
          tx,
          scope.roundId,
          'captured',
        );
        const reservation = await markLockedRoundBotModelCall(
          tx,
          scope.roundId,
        );
        await verifyLockedBotWorker(tx, scope, token);
        await requireBotSpeakingWindow(tx, scope);
        const id = input.nextId(),
          executionToken = input.nextToken();
        await startLockedRoundAgentRun(tx, {
          id,
          participantId: scope.roundParticipantId,
          kind:
            request.kind === 'tts'
              ? 'tts'
              : (context.run.kind as 'speech' | 'cross_ex'),
          model,
          configuration: {
            ...scope,
            parentAgentRunId: scope.agentRunId,
            executionTokenDigest: agentLeaseDigest(executionToken),
            providerOutcome: 'unknown',
          },
        });
        await tx
          .update(agentRuns)
          .set({
            requests: 1,
            characters: request.kind === 'tts' ? request.characters : 0,
          })
          .where(eq(agentRuns.id, id));
        return {
          execution: { id, token: executionToken },
          round: context.round,
          seat: context.seat,
          profile,
          model,
          utterances: history,
          reservation,
        };
      }),
    finishGeneration: (
      scope: BotPublicationScope,
      execution: Execution,
      outcome: Outcome,
      usage: Usage,
    ) =>
      input.run(async (tx) => {
        requireUsage(outcome, usage);
        const run = await lockAgentAccounting(tx, {
          id: execution.id,
          participantId: scope.roundParticipantId,
          token: execution.token,
          bindings: { ...scope, parentAgentRunId: scope.agentRunId },
        });
        requireRunUsage(run, usage);
        if (run.endedAt) {
          requireSameSettlement(run, outcome, usage);
          return;
        }
        const configuration = run.configurationSnapshot;
        await tx
          .update(agentRuns)
          .set({
            ...usage,
            endedAt: sql`clock_timestamp()`,
            configurationSnapshot: {
              ...configuration,
              providerOutcome: outcome,
            },
          })
          .where(eq(agentRuns.id, run.id));
      }),
  };
}
