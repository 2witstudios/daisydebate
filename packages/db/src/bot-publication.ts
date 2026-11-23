import { tryInstantMs } from '@daisy/clock';
import type { AllowanceAccountPolicy } from './usage-ledger';
import { and, eq, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type { BoundedTransaction } from './bounded-transaction';
import {
  createBotGenerationOperations,
  type BotGenerationSession,
} from './bot-generation';
import type { BotClaimActivity } from '@daisy/protocol/bot-admission';
export {
  isFinalBotSpeechRefusal,
  refuseFinalSpeech,
} from './bot-generation-rules';
import {
  leaseExpiresIn,
  leaseTokenDigest,
  nextEpoch,
  requireLeaseToken,
} from './lease';
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
import { peerLineCovers } from './bot-peer-line';
import { agentRuns } from './schema/agent-runs';
import { scanBotWorkers } from './bot-worker-discovery';
import { roundBotPublications } from './schema/round-bot-publications';
import { requireLeaseMs } from './lease';
export type { BotPublicationScope } from './bot-publication-context';
export type { BotPhrase, BotPhraseEnd } from './bot-phrases';
type Target = Pick<
  BotPublicationScope,
  'roundId' | 'roundParticipantId' | 'segmentId'
>;
type ClaimContext = Awaited<ReturnType<typeof lockRoundAgentContext>>;
type ClaimRow = typeof roundBotPublications.$inferSelect;
type ClaimResult = BotClaimActivity & {
  readonly scope: BotPublicationScope;
  readonly token: string;
  readonly leaseExpiresAt: string;
};
export type BotClaimSession = {
  readonly round: ClaimContext['round'];
  readonly seat: ClaimContext['seat'];
  readonly readControl: () => Promise<
    ClaimContext['round']['segments'][number] | undefined
  >;
  readonly apply: (activity: BotClaimActivity) => Promise<void>;
};
export type BotAdmission = {
  readonly generationAdmission: (
    session: BotGenerationSession,
  ) => Promise<void>;
  readonly claimAdmission: (session: BotClaimSession) => Promise<void>;
};
export type { BotGenerationSession } from './bot-generation';
type ClaimState =
  | { readonly kind: 'open' }
  | { readonly kind: 'reading' }
  | {
      readonly kind: 'prepared';
      readonly current: ClaimRow | undefined;
      readonly now: Date;
      readonly epoch: number;
    }
  | { readonly kind: 'applying' }
  | { readonly kind: 'settled'; readonly result: ClaimResult }
  | { readonly kind: 'closed' };
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
  readonly generationAdmission: BotAdmission['generationAdmission'];
  readonly claimAdmission: BotAdmission['claimAdmission'];
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
        let state: ClaimState = { kind: 'open' };
        const phase = () => state;
        const reading = () => {
          if (phase().kind !== 'reading') throw createAppError('CONFLICT');
        };
        const writing = () => {
          if (phase().kind !== 'applying') throw createAppError('CONFLICT');
        };
        try {
          await input.claimAdmission({
            round,
            seat,
            readControl: async () => {
              if (phase().kind !== 'open') throw createAppError('CONFLICT');
              state = { kind: 'reading' };
              const [previous] = await tx
                .select()
                .from(roundBotPublications)
                .where(claimWhere(target));
              reading();
              if (previous)
                await tx
                  .select()
                  .from(agentRuns)
                  .where(eq(agentRuns.id, previous.agentRunId))
                  .for('update');
              reading();
              const [current] = await tx
                .select()
                .from(roundBotPublications)
                .where(claimWhere(target))
                .for('update');
              reading();
              const now = await readDatabaseTime(tx);
              reading();
              await requireBotControlSegment(tx, target);
              const epoch = nextPublicationClaim(current, now);

              reading();
              state = { kind: 'prepared', current, now, epoch };
              return round.segments.find(
                (candidate) => candidate.id === target.segmentId,
              );
            },
            apply: async (activity) => {
              const prepared = phase();
              if (prepared.kind !== 'prepared')
                throw createAppError('CONFLICT');
              const segment = round.segments.find(
                (candidate) => candidate.id === target.segmentId,
              );
              if (!segment || segment.type !== activity.segmentType)
                throw createAppError('CONFLICT');
              const { current, now, epoch } = prepared;
              state = { kind: 'applying' };
              const agentRunId = input.nextId(),
                token = input.nextToken();
              const claim = publicationClaim({
                target,
                agentRunId,
                epoch,
                leaseTokenDigest: leaseTokenDigest(token),
                now,
                leaseMs: input.leaseMs,
              });
              // A takeover first closes what the lost worker left open.
              writing();
              if (current)
                await closeAbandonedBotLines(
                  tx,
                  target.roundId,
                  target.roundParticipantId,
                );
              writing();
              if (current)
                await endLockedRoundAgentRun(
                  tx,
                  current.agentRunId,
                  target.roundParticipantId,
                );
              writing();
              await startLockedRoundAgentRun(tx, {
                id: agentRunId,
                participantId: target.roundParticipantId,
                kind: activity.segmentType,
                model: input.models[activity.segmentType],
                configuration: claim.configuration,
              });
              writing();
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

              writing();
              state = {
                kind: 'settled',
                result: {
                  ...activity,
                  scope: claim.scope,
                  token,
                  leaseExpiresAt: value.leaseExpiresAt.toISOString(),
                },
              };
            },
          });
          const settled = phase();
          if (settled.kind !== 'settled') throw createAppError('CONFLICT');
          return settled.result;
        } finally {
          state = { kind: 'closed' };
        }
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
        requireLeaseToken(token, claim.leaseTokenDigest);
        const now = await readDatabaseTime(tx);
        if (claim.leaseExpiresAt.getTime() <= now.getTime())
          throw createAppError('CONFLICT', 'Publication lease expired');
        await requireBotRoom(tx, scope, room);
        await requireBotSpeakingWindow(tx, scope);
      }),
    /**
     * Whether the line holding what a peer said at `at` is in the transcript,
     * read without a lock under the claim's own token and live lease. It
     * grants nothing: a cross-examination answer waits on it, briefly.
     */
    readPeerLine: (
      scope: BotPublicationScope,
      token: string,
      peers: readonly string[],
      at: string,
    ) =>
      input.run(async (tx) => {
        const atMs = tryInstantMs(at);
        if (atMs === undefined || peers.length > 255)
          throw createAppError('VALIDATION');
        const [claim] = await tx
          .select()
          .from(roundBotPublications)
          .where(claimWhere(scope));
        requireClaimScope(claim, scope);
        requireLeaseToken(token, claim.leaseTokenDigest);
        const now = await readDatabaseTime(tx);
        if (claim.leaseExpiresAt.getTime() <= now.getTime())
          throw createAppError('CONFLICT', 'Publication lease expired');
        return peerLineCovers(tx, scope, peers, new Date(atMs));
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
            leaseExpiresAt: leaseExpiresIn(input.leaseMs),
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

/** A new claim waits for the previous lease to expire, then takes the next epoch. */
export function nextPublicationClaim(
  current:
    | {
        readonly leaseExpiresAt: Date;
        readonly publicationEpoch: number;
      }
    | undefined,
  now: Date,
): number {
  if (current && current.leaseExpiresAt.getTime() > now.getTime())
    throw createAppError('CONFLICT', 'Publication already claimed');
  return nextEpoch(
    current?.publicationEpoch ?? 0,
    'Publication epoch exhausted',
  );
}

/** One run per claim; its own service identity is the only publisher. */
export const publicationClaim = (input: {
  readonly target: Target;
  readonly agentRunId: string;
  readonly epoch: number;
  readonly leaseTokenDigest: string;
  readonly now: Date;
  readonly leaseMs: number;
}) => {
  const serviceId = `agent-run:${input.agentRunId}`;
  const scope: BotPublicationScope = {
    ...input.target,
    agentRunId: input.agentRunId,
    serviceId,
    publicationEpoch: input.epoch,
  };
  return {
    scope,
    configuration: {
      roundId: input.target.roundId,
      roundParticipantId: input.target.roundParticipantId,
      segmentId: input.target.segmentId,
      serviceId,
      publicationEpoch: input.epoch,
    },
    row: {
      ...scope,
      leaseTokenDigest: input.leaseTokenDigest,
      leaseExpiresAt: new Date(input.now.getTime() + input.leaseMs),
    },
  };
};
