import { and, eq, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type { BoundedTransactionContext } from './transaction-context';
import type { BoundedTransaction } from './bounded-transaction';
import { agentLeaseDigest } from './round-agent-lease';
import { lockAgentAccounting } from './agent-accounting';
import {
  generationRun,
  requireRequest,
  requireRunUsage,
  requireSameSettlement,
  requireSpeechBudget,
  requireSpeechPolicy,
  requireUsage,
  type Execution,
  type GenerationRequest,
  type Outcome,
  type SpeechPolicy,
  type Usage,
} from './bot-generation-rules';
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

async function speechModel(
  tx: BoundedTransactionContext,
  scope: BotPublicationScope,
  characters: number,
  policy: SpeechPolicy,
) {
  const model = requireSpeechPolicy(policy);
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
  requireSpeechBudget(
    Number(total?.characters ?? 0),
    characters,
    policy.speechBudget!,
  );
  return model;
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
        const generated = generationRun(request, context.run.kind);
        await startLockedRoundAgentRun(tx, {
          id,
          participantId: scope.roundParticipantId,
          kind: generated.kind,
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
            characters: generated.characters,
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
          bindings: {
            roundId: scope.roundId,
            roundParticipantId: scope.roundParticipantId,
            segmentId: scope.segmentId,
            agentRunId: scope.agentRunId,
            serviceId: scope.serviceId,
            publicationEpoch: scope.publicationEpoch,
            parentAgentRunId: scope.agentRunId,
          },
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
