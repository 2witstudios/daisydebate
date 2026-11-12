import type { AllowanceAccountPolicy } from './usage-ledger';
import { and, eq, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type { BoundedTransaction } from './bounded-transaction';
import { createBotGenerationOperations } from './bot-generation';
export { isFinalBotSpeechRefusal } from './bot-generation-rules';
import { agentLeaseDigest, requireAgentLeaseToken } from './round-agent-lease';
import {
  endLockedRoundAgentRun,
  lockRoundAgentContext,
  startLockedRoundAgentRun,
} from './round-agent-runs';
import { readDatabaseTime } from './database-clock';
import {
  botSegmentDueAt,
  verifyLockedBotWorker,
  requireBotRoom,
  requireBotSpeakingWindow,
  requireBotControlSegment,
  requireClaimScope,
  type BotPublicationScope,
} from './bot-publication-context';
import {
  authorizeLockedBotPhrase,
  closeAbandonedBotLines,
  revealLockedBotPhrase,
  endLockedBotPhrase,
  type BotPhrase,
  type BotPhraseEnd,
} from './bot-phrases';
import { peerLineReaches } from './bot-peer-line';
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
        // A takeover first closes what the lost worker left open.
        if (current)
          await closeAbandonedBotLines(
            tx,
            target.roundId,
            target.roundParticipantId,
          );
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
        // Read before any lock, so a worker's clock offset never counts a
        // lock wait, and its local stop is never early by one.
        const now = await readDatabaseTime(tx);
        await verifyLockedBotWorker(tx, scope, token);
        await requireBotSpeakingWindow(tx, scope);
        return {
          segmentDueAt: await botSegmentDueAt(tx, scope),
          /** The database clock at the start of this read, for a worker's clock offset. */
          now: now.toISOString(),
        };
      }),
    /**
     * The floor while a phrase plays, read without taking a lock: the claim,
     * its token and lease, its vendor room, and an open floor in the live
     * segment with no incident. Cheap enough to read four times a second.
     */
    watchBotFloor: (scope: BotPublicationScope, token: string, room: string) =>
      input.run(async (tx) => {
        const [claim] = await tx
          .select()
          .from(roundBotPublications)
          .where(claimWhere(scope));
        requireClaimScope(claim, scope);
        requireAgentLeaseToken(token, claim.leaseTokenDigest);
        const now = await readDatabaseTime(tx);
        if (claim.leaseExpiresAt.getTime() <= now.getTime())
          throw createAppError('CONFLICT', 'Publication lease expired');
        await requireBotRoom(tx, scope, room);
        await requireBotSpeakingWindow(tx, scope);
      }),
    /**
     * Whether a peer's captured words up to `since` are in the transcript,
     * read without a lock under the claim's own token and live lease. It
     * grants nothing: a cross-examination answer waits on it, briefly.
     */
    readPeerLine: (
      scope: BotPublicationScope,
      token: string,
      peers: readonly string[],
      since: string,
    ) =>
      input.run(async (tx) => {
        const at = new Date(since);
        if (!Number.isFinite(at.getTime()) || peers.length > 255)
          throw createAppError('VALIDATION');
        const [claim] = await tx
          .select()
          .from(roundBotPublications)
          .where(claimWhere(scope));
        requireClaimScope(claim, scope);
        requireAgentLeaseToken(token, claim.leaseTokenDigest);
        const now = await readDatabaseTime(tx);
        if (claim.leaseExpiresAt.getTime() <= now.getTime())
          throw createAppError('CONFLICT', 'Publication lease expired');
        return peerLineReaches(tx, scope, peers, at);
      }),
    /** Writes a phrase's line as its audio starts, and rings the doorbell. */
    revealBotPhrase: (
      scope: BotPublicationScope,
      token: string,
      phrase: BotPhrase,
      room: string,
      startedAt?: string,
    ) =>
      input.run((tx) =>
        revealLockedBotPhrase(tx, {
          scope,
          token,
          phrase,
          room,
          nextId: input.nextId,
          ...(startedAt === undefined ? {} : { startedAt }),
        }),
      ),
    /** Authorizes a phrase before any of its audio plays (ADR 0122). */
    beginBotPhrase: (
      scope: BotPublicationScope,
      token: string,
      phrase: BotPhrase,
      room: string,
    ) =>
      input.run((tx) =>
        authorizeLockedBotPhrase(tx, { scope, token, phrase, room }),
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
