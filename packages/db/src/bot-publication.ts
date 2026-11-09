import type { AllowanceAccountPolicy } from './usage-ledger';
import { and, eq, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type { BoundedTransaction } from './bounded-transaction';
import { createBotGenerationOperations } from './bot-generation';
export { isFinalBotSpeechRefusal } from './bot-generation-rules';
import { agentLeaseDigest } from './round-agent-lease';
import {
  endLockedRoundAgentRun,
  lockRoundAgentContext,
  startLockedRoundAgentRun,
} from './round-agent-runs';
import { readDatabaseTime } from './database-clock';
import {
  botSegmentDueAt,
  verifyLockedBotWorker,
  requireBotSpeakingWindow,
  requireBotControlSegment,
  type BotPublicationScope,
} from './bot-publication-context';
import {
  beginLockedBotPhrase,
  endLockedBotPhrase,
  type BotPhrase,
  type BotPhraseEnd,
} from './bot-phrases';
import { agentRuns } from './schema/agent-runs';
import { scanBotWorkers } from './bot-worker-discovery';
import { roundBotPublications } from './schema/round-bot-publications';
import { requireLeaseMs } from './lease-policy';
import {
  nextPublicationClaim,
  publicationClaim,
  requirePublishingSeat,
} from './bot-publication-rules';
export type { BotPublicationScope } from './bot-publication-context';
export type { BotPhrase, BotPhraseEnd } from './bot-phrases';
type Target = Pick<
  BotPublicationScope,
  'roundId' | 'roundParticipantId' | 'segmentId'
>;
/** Server-only capability; entropy and IDs are supplied by the authenticated composition edge. */
export function createBotPublicationOperations(input: {
  readonly run: BoundedTransaction;
  readonly nextId: () => string;
  readonly nextToken: () => string;
  readonly leaseMs: number;
  readonly models: { readonly speech: string; readonly cross_ex: string };
  readonly ttsModel?: string;
  readonly speechBudget?: number;
  readonly accountEligible: AllowanceAccountPolicy;
}) {
  requireLeaseMs(input.leaseMs);
  const claimWhere = (
    scope: Pick<BotPublicationScope, 'roundId' | 'roundParticipantId'>,
  ) =>
    and(
      eq(roundBotPublications.roundId, scope.roundId),
      eq(roundBotPublications.roundParticipantId, scope.roundParticipantId),
    );
  return {
    ...createBotGenerationOperations(input),
    scanWorkers: (limit: number) =>
      input.run((tx) => scanBotWorkers(tx, limit)),
    claimWorker: (target: Target) =>
      input.run(async (tx) => {
        const { round, seat } = await lockRoundAgentContext(
          tx,
          target.roundId,
          target.roundParticipantId,
        );
        requirePublishingSeat(round, seat);
        const [previous] = await tx
          .select()
          .from(roundBotPublications)
          .where(claimWhere(target));
        if (previous)
          await tx
            .select()
            .from(agentRuns)
            .where(eq(agentRuns.id, previous.agentRunId))
            .for('update');
        const [current] = await tx
          .select()
          .from(roundBotPublications)
          .where(claimWhere(target))
          .for('update');
        const now = await readDatabaseTime(tx);
        await requireBotControlSegment(tx, target);
        const epoch = nextPublicationClaim(current, now);
        const segment = round.segments.find(
          (candidate) => candidate.id === target.segmentId,
        );
        if (!segment) throw createAppError('CONFLICT');
        const agentRunId = input.nextId(),
          token = input.nextToken();
        const claim = publicationClaim({
          target,
          agentRunId,
          epoch,
          leaseTokenDigest: agentLeaseDigest(token),
          now,
          leaseMs: input.leaseMs,
        });
        if (current)
          await endLockedRoundAgentRun(
            tx,
            current.agentRunId,
            target.roundParticipantId,
          );
        await startLockedRoundAgentRun(tx, {
          id: agentRunId,
          participantId: target.roundParticipantId,
          kind: segment.type,
          model: input.models[segment.type],
          configuration: claim.configuration,
        });
        const value = claim.row;
        await tx
          .insert(roundBotPublications)
          .values(value)
          .onConflictDoUpdate({
            target: [
              roundBotPublications.roundId,
              roundBotPublications.roundParticipantId,
            ],
            set: value,
          });
        const { scope } = claim;
        return {
          scope,
          token,
          leaseExpiresAt: value.leaseExpiresAt.toISOString(),
          segmentType: segment.type,
          /** In cross-examination the scheduled seat asks first. */
          opensExchange: round.rules.segments.some(
            (rule) =>
              rule.key === segment.rulesSegmentKey &&
              rule.side === seat.role &&
              rule.slot === seat.slot,
          ),
          /** Activity peers only; grants no authority over another seat. */
          peerParticipantIds: round.participants
            .filter((row) => row.role !== 'judge' && row.id !== seat.id)
            .map((row) => row.id),
        };
      }),
    /** The claim's live floor now, and when its segment is due. */
    verifyBotPublication: (scope: BotPublicationScope, token: string) =>
      input.run(async (tx) => {
        await verifyLockedBotWorker(tx, scope, token);
        await requireBotSpeakingWindow(tx, scope);
        return { segmentDueAt: await botSegmentDueAt(tx, scope) };
      }),
    /** Authors one phrase's utterance as it starts playing (ADR 0122). */
    beginBotPhrase: (
      scope: BotPublicationScope,
      token: string,
      phrase: BotPhrase,
      room: string,
    ) =>
      input.run((tx) =>
        beginLockedBotPhrase(tx, {
          scope,
          token,
          phrase,
          room,
          nextId: input.nextId,
        }),
      ),
    /** Closes a started phrase: whole, or cut at what was heard. */
    endBotPhrase: (
      scope: BotPublicationScope,
      token: string,
      phraseId: string,
      end: BotPhraseEnd,
    ) =>
      input.run((tx) =>
        endLockedBotPhrase(tx, { scope, token, phraseId, end }),
      ),
    verifyBotWorker: (scope: BotPublicationScope, token: string) =>
      input.run(async (tx) => {
        await verifyLockedBotWorker(tx, scope, token);
      }),
    renewWorker: (scope: BotPublicationScope, token: string) =>
      input.run(async (tx) => {
        await verifyLockedBotWorker(tx, scope, token);
        const rows = await tx
          .update(roundBotPublications)
          .set({
            leaseExpiresAt: sql`clock_timestamp()+${input.leaseMs}*interval '1 millisecond'`,
          })
          .where(
            and(
              claimWhere(scope),
              sql`${roundBotPublications.leaseExpiresAt}>clock_timestamp()`,
            ),
          )
          .returning({ expires: roundBotPublications.leaseExpiresAt });
        if (!rows[0]) throw createAppError('CONFLICT');
        return rows[0].expires.toISOString();
      }),
    revoke: (scope: BotPublicationScope, token: string) =>
      input.run(async (tx) => {
        await verifyLockedBotWorker(tx, scope, token);
        await tx
          .update(roundBotPublications)
          .set({ leaseExpiresAt: sql`clock_timestamp()` })
          .where(claimWhere(scope));
        await endLockedRoundAgentRun(
          tx,
          scope.agentRunId,
          scope.roundParticipantId,
        );
      }),
  };
}

export { verifyBotWorkerPrincipalLocked } from './bot-worker-authority';
