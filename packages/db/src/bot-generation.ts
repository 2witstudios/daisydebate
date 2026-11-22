import type { AllowanceAccountPolicy } from './usage-ledger';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type { BoundedTransaction } from './bounded-transaction';
import { agentLeaseDigest } from './round-agent-lease';
import { lockAgentAccounting } from './agent-accounting';
import {
  generationRun,
  requireRequest,
  requireRunUsage,
  requireSameSettlement,
  requireSpeechPolicy,
  requireUsage,
  type Execution,
  type GenerationRequest,
  type Outcome,
  type Usage,
} from './bot-generation-rules';
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
                  characters: sql<number>`coalesce(sum(${agentRuns.characters}),0)`,
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
                  executionTokenDigest: agentLeaseDigest(executionToken),
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
