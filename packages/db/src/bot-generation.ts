import type { AllowanceAccountPolicy } from './usage-ledger';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type { BoundedTransaction } from './bounded-transaction';
import { leaseTokenDigest } from './lease';
import { lockAgentAccounting, validAgentCounter } from './agent-accounting';
import { startLockedRoundAgentRun } from './round-agent-runs';
import {
  lockBotAdmission,
  markLockedRoundBotModelCall,
  refundUnservedPracticeLocked,
} from './round-bot-admission';
import {
  requireBotSpeakingWindow,
  botSegmentDueAt,
  verifyLockedBotWorker,
  type BotPublicationScope,
} from './bot-publication-context';
import { rounds } from './schema/rounds';
import { agentRuns } from './schema/agent-runs';
import { botProfiles } from './schema/bot-profiles';
import { readOrderedRoundUtterances } from './round-utterance-projection';
import { utterances } from './schema/utterances';
import { parsedColumn, postgresInt8 } from './raw-rows';
import { z } from 'zod';

type WorkerContext = Awaited<ReturnType<typeof verifyLockedBotWorker>>;
type GenerationResult = {
  readonly execution: Execution;
  readonly round: WorkerContext['round'];
  readonly seat: WorkerContext['seat'];
  readonly profile: typeof botProfiles.$inferSelect;
  readonly model: string;
  readonly utterances: Awaited<ReturnType<typeof readOrderedRoundUtterances>>;
  readonly reservation: Awaited<ReturnType<typeof markLockedRoundBotModelCall>>;
};
export type BotGenerationSession = {
  readonly request: GenerationRequest;
  readonly worker: { readonly kind: string; readonly model: string | null };
  readonly readAnswered: () => Promise<boolean>;
  readonly readSaid: () => Promise<boolean>;
  readonly speechPolicy: () => ReturnType<typeof requireSpeechPolicy>;
  readonly readSpoken: () => Promise<number>;
  readonly apply: (model: string) => Promise<void>;
};
type GenerationState =
  | { readonly kind: 'open' }
  | { readonly kind: 'applying' }
  | { readonly kind: 'settled'; readonly result: GenerationResult }
  | { readonly kind: 'closed' };
/** Dispatch authority and usage settlement are distinct capabilities; neither writes speech. */
export function createBotGenerationOperations(input: {
  readonly run: BoundedTransaction;
  readonly nextId: () => string;
  readonly nextToken: () => string;
  readonly ttsModel?: string;
  readonly speechBudget?: number;
  readonly accountEligible: AllowanceAccountPolicy;
  readonly generationAdmission: (
    session: BotGenerationSession,
  ) => Promise<void>;
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
        let state: GenerationState = { kind: 'open' };
        const phase = () => state;
        const open = () => {
          if (phase().kind !== 'open') throw createAppError('CONFLICT');
        };
        const writing = () => {
          if (phase().kind !== 'applying') throw createAppError('CONFLICT');
        };
        try {
          await input.generationAdmission({
            request,
            worker: { kind: context.run.kind, model: context.run.model },
            speechPolicy: () => {
              open();
              return requireSpeechPolicy(input);
            },
            readAnswered: async () => {
              open();
              const [row] = await tx
                .select({ id: agentRuns.id })
                .from(agentRuns)
                .where(
                  and(
                    eq(agentRuns.roundParticipantId, scope.roundParticipantId),
                    eq(agentRuns.kind, 'speech'),
                    sql`${agentRuns.configurationSnapshot}->>'segmentId' = ${scope.segmentId}`,
                    sql`${agentRuns.configurationSnapshot}->>'providerOutcome' = 'received'`,
                  ),
                )
                .limit(1);
              open();
              return row !== undefined;
            },
            readSaid: async () => {
              open();
              const [row] = await tx
                .select({ id: utterances.id })
                .from(utterances)
                .where(
                  and(
                    eq(utterances.roundId, scope.roundId),
                    eq(utterances.segmentId, scope.segmentId),
                    eq(utterances.roundParticipantId, scope.roundParticipantId),
                    isNotNull(utterances.botPhraseId),
                  ),
                )
                .limit(1);
              open();
              return row !== undefined;
            },
            readSpoken: async () => {
              open();
              const [total] = await tx
                .select({
                  characters: parsedColumn(
                    postgresInt8,
                    sql`coalesce(sum(${agentRuns.characters}),0)`,
                  ),
                })
                .from(agentRuns)
                .where(
                  and(
                    eq(agentRuns.roundParticipantId, scope.roundParticipantId),
                    eq(agentRuns.kind, 'tts'),
                  ),
                );
              open();
              return Number(total?.characters ?? 0);
            },
            apply: async (model) => {
              open();
              if (!model.trim()) throw createAppError('VALIDATION');
              state = { kind: 'applying' };
              const history = await readOrderedRoundUtterances(
                tx,
                scope.roundId,
                'spoken',
              );
              writing();
              const before = await botSegmentDueAt(tx, scope);
              writing();
              const reservation = await markLockedRoundBotModelCall(tx, {
                roundId: scope.roundId,
                before,
                accountEligible: input.accountEligible,
              });
              writing();
              await verifyLockedBotWorker(tx, scope, token);
              writing();
              await requireBotSpeakingWindow(tx, scope);
              writing();
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
                  executionTokenDigest: leaseTokenDigest(executionToken),
                  providerOutcome: 'unknown',
                },
              });
              writing();
              await tx
                .update(agentRuns)
                .set({
                  requests: 1,
                  characters: generated.characters,
                })
                .where(eq(agentRuns.id, id));
              const result: GenerationResult = {
                execution: { id, token: executionToken },
                round: context.round,
                seat: context.seat,
                profile,
                model,
                utterances: history,
                reservation,
              };
              writing();
              state = { kind: 'settled', result };
            },
          });
          const settled = phase();
          if (settled.kind !== 'settled') throw createAppError('CONFLICT');
          return settled.result;
        } finally {
          state = { kind: 'closed' };
        }
      }),
    finishGeneration: (
      scope: BotPublicationScope,
      execution: Execution,
      outcome: Outcome,
      usage: Usage,
    ) =>
      input.run(async (tx) => {
        requireUsage(outcome, usage);
        // Round -> execution -> usage order also holds during terminal settlement.
        await tx
          .select({ id: rounds.id })
          .from(rounds)
          .where(eq(rounds.id, scope.roundId))
          .for('no key update');
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
        requireRunUsage(run, outcome, usage);
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
        await refundUnservedPracticeLocked(tx, scope.roundId);
      }),
  };
}

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
