import { createAppError } from '@daisy/errors';
import { and, eq, isNull } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import type { BoundedTransaction } from './bounded-transaction';
import type { BoundedTransactionContext } from './transaction-context';
import { lockMediaRound, mediaId } from './media-session-authority';
import {
  executeLockedRoundTick,
  type LockedRoundTickInput,
} from './round-clock-transaction';
import { hydrateRoundRows, type RoundHydration } from './round-hydration';
import type { RoundCommandAuthority } from '@daisy/protocol';
import { mediaParticipants } from './schema/media-sessions';
import { sampleRoundExecutionTime } from './round-execution-time';
import { mediaSessions } from './schema/media-sessions';
import { mediaVendorMutations } from './schema/media-vendor-mutations';

type Session = typeof mediaSessions.$inferSelect;
export type MediaVendorIntent =
  | {
      readonly kind: 'create' | 'delete';
      readonly identity: null;
      readonly payload: Record<string, never>;
    }
  | {
      readonly kind: 'remove';
      readonly identity: string;
      readonly payload: Record<string, never>;
    }
  | {
      readonly kind: 'permissions';
      readonly identity: string;
      readonly payload: {
        readonly publish: ('camera' | 'microphone')[];
        readonly subscribe: boolean;
        readonly hidden: boolean;
        readonly capture: false;
      };
    };
export type MediaReconcileFence = {
  readonly sessionId: string;
  readonly owner: string;
  readonly epoch: number;
};
const LEASE_MS = 15_000;

/** Durable serialization only; every provider call happens after these bounded transactions commit. */
export function createMediaReconcileStore(input: {
  readonly database: BunSQLDatabase;
  readonly run: BoundedTransaction;
  readonly nextId: () => string;
}) {
  const pending = (tx: BoundedTransactionContext, sessionId: string) =>
    tx
      .select({ id: mediaVendorMutations.id })
      .from(mediaVendorMutations)
      .where(
        and(
          eq(mediaVendorMutations.sessionId, sessionId),
          isNull(mediaVendorMutations.settledAt),
        ),
      );
  const locked = async (tx: BoundedTransactionContext, sessionId: string) => {
    const [initial] = await tx
      .select({ roundId: mediaSessions.roundId })
      .from(mediaSessions)
      .where(eq(mediaSessions.id, mediaId(sessionId)));
    if (!initial) throw createAppError('NOT_FOUND');
    await lockMediaRound(tx, initial.roundId);
    const [session] = await tx
      .select()
      .from(mediaSessions)
      .where(eq(mediaSessions.id, sessionId))
      .for('update');
    if (!session) throw createAppError('NOT_FOUND');
    return session;
  };
  const fence = (session: Session, claim: MediaReconcileFence, now: Date) => {
    if (
      session.reconcileOwner !== claim.owner ||
      session.reconcileEpoch !== claim.epoch ||
      !session.reconcileLeaseUntil ||
      session.reconcileLeaseUntil <= now
    )
      throw createAppError('CONFLICT', 'Media reconciliation lease changed');
  };
  return {
    async requestMediaReconcile(request: {
      readonly roundId: string;
      readonly actorId?: string;
    }) {
      return input.run(async (tx) => {
        await lockMediaRound(tx, mediaId(request.roundId), request.actorId);
        const [session] = await tx
          .select()
          .from(mediaSessions)
          .where(eq(mediaSessions.roundId, request.roundId))
          .for('update');
        if (!session) throw createAppError('NOT_FOUND');
        const now = new Date(await sampleRoundExecutionTime(tx));
        const version = session.reconcileRequestVersion + 1;
        await tx
          .update(mediaSessions)
          .set({ reconcileRequestedAt: now, reconcileRequestVersion: version })
          .where(eq(mediaSessions.id, session.id));
        return { sessionId: session.id, version };
      });
    },
    async claimMediaReconcile(request: {
      readonly sessionId: string;
      readonly owner: string;
    }) {
      mediaId(request.owner);
      return input.run(async (tx) => {
        const session = await locked(tx, request.sessionId);
        const now = new Date(await sampleRoundExecutionTime(tx));
        if (
          session.reconcileOwner &&
          session.reconcileLeaseUntil &&
          session.reconcileLeaseUntil > now
        )
          return {
            kind: 'wait' as const,
            retryAt: session.reconcileLeaseUntil.toISOString(),
          };
        const earliest =
          (session.reconcileStartedAt?.getTime() ?? -Infinity) + 500;
        if (now.getTime() < earliest)
          return {
            kind: 'wait' as const,
            retryAt: new Date(earliest).toISOString(),
          };
        const outstanding = await pending(tx, session.id);
        const epoch = session.reconcileEpoch + 1;
        const unsafeAt = session.unsafeAt ?? (outstanding.length ? now : null);
        await tx
          .update(mediaSessions)
          .set({
            reconcileEpoch: epoch,
            reconcileOwner: request.owner,
            reconcileLeaseUntil: new Date(now.getTime() + LEASE_MS),
            reconcileStartedAt: now,
            reconcileRunningVersion: session.reconcileRequestVersion,
            unsafeAt,
          })
          .where(eq(mediaSessions.id, session.id));
        return {
          kind: 'claimed' as const,
          fence: { sessionId: session.id, owner: request.owner, epoch },
          roundId: session.roundId,
          roomName: session.roomName,
          unsafe: unsafeAt !== null,
          runningVersion: session.reconcileRequestVersion,
        };
      });
    },
    async beginMediaMutation(
      request: MediaReconcileFence & {
        readonly intent: MediaVendorIntent;
        readonly buildProjection: LockedRoundTickInput['buildProjection'];
        readonly authorize: (context: {
          readonly round: RoundHydration;
          readonly participants: RoundCommandAuthority['participants'];
          readonly now: string;
          readonly finalSegmentEndedAt: string | null;
          readonly participantId: string | null;
        }) => void;
      },
    ) {
      return input.run(async (tx) => {
        const session = await locked(tx, request.sessionId);
        const now = new Date(await sampleRoundExecutionTime(tx));
        fence(session, request, now);
        const outstanding = await pending(tx, session.id);
        if (
          (session.unsafeAt || outstanding.length) &&
          !['delete', 'remove'].includes(request.intent.kind)
        )
          throw createAppError('CONFLICT', 'Media recovery is unresolved');
        const authority = await lockMediaRound(tx, session.roundId);
        const tick = await executeLockedRoundTick(tx, {
          roundId: session.roundId,
          buildProjection: request.buildProjection,
        });
        const round = await hydrateRoundRows(tx, session.roundId);
        if (!round) throw createAppError('NOT_FOUND');
        let participantId: string | null = null;
        if (request.intent.identity !== null) {
          const [binding] = await tx
            .select({ participantId: mediaParticipants.roundParticipantId })
            .from(mediaParticipants)
            .where(
              and(
                eq(mediaParticipants.sessionId, session.id),
                eq(
                  mediaParticipants.identity,
                  mediaId(request.intent.identity),
                ),
              ),
            );
          if (!binding) throw createAppError('AUTHORIZATION');
          participantId = binding.participantId;
        }
        request.authorize({
          round,
          participants: authority.participants,
          now: tick.now,
          finalSegmentEndedAt: tick.finalSegmentEndedAt,
          participantId,
        });
        const dispatchedAt = new Date(await sampleRoundExecutionTime(tx));
        fence(session, request, dispatchedAt);
        const id = mediaId(input.nextId());
        await tx.insert(mediaVendorMutations).values({
          id,
          sessionId: session.id,
          epoch: request.epoch,
          ...request.intent,
          dispatchedAt,
        });
        await tx
          .update(mediaSessions)
          .set({
            reconcileLeaseUntil: new Date(dispatchedAt.getTime() + LEASE_MS),
          })
          .where(eq(mediaSessions.id, session.id));
        return id;
      });
    },
    /** Only a successful provider response resolves the dispatched operation. A rejected network promise is not proof. */
    async settleMediaMutation(id: string) {
      return input.run(async (tx) => {
        const [operation] = await tx
          .select()
          .from(mediaVendorMutations)
          .where(eq(mediaVendorMutations.id, mediaId(id)))
          .for('update');
        if (!operation || operation.settledAt) return;
        await tx
          .update(mediaVendorMutations)
          .set({
            settledAt: new Date(await sampleRoundExecutionTime(tx)),
            outcome: 'succeeded',
          })
          .where(eq(mediaVendorMutations.id, id));
      });
    },
    async markMediaUnsafe(request: MediaReconcileFence) {
      return input.run(async (tx) => {
        const session = await locked(tx, request.sessionId);
        const now = new Date(await sampleRoundExecutionTime(tx));
        // Even a stale worker's ambiguous dispatch must close newer admission.
        await tx
          .update(mediaSessions)
          .set({
            unsafeAt: session.unsafeAt ?? now,
            deletionRequestedAt: session.deletionRequestedAt ?? now,
          })
          .where(eq(mediaSessions.id, session.id));
      });
    },
    async finishMediaReconcile(
      request: MediaReconcileFence & {
        readonly absenceVerified: boolean;
        readonly terminal: boolean;
      },
    ) {
      return input.run(async (tx) => {
        const session = await locked(tx, request.sessionId);
        const now = new Date(await sampleRoundExecutionTime(tx));
        fence(session, request, now);
        const unresolved = (await pending(tx, session.id)).length > 0;
        const cleaned = request.absenceVerified && !unresolved;
        await tx
          .update(mediaSessions)
          .set({
            reconcileOwner: null,
            reconcileLeaseUntil: null,
            reconcileCompletedAt: now,
            reconcileServedVersion: session.reconcileRunningVersion,
            ...(cleaned
              ? {
                  unsafeAt: null,
                  ...(request.terminal
                    ? { endedAt: session.endedAt ?? now }
                    : {}),
                }
              : {}),
            ...(request.terminal
              ? { deletionRequestedAt: session.deletionRequestedAt ?? now }
              : {}),
          })
          .where(eq(mediaSessions.id, session.id));
        return {
          safe: !unresolved && (session.unsafeAt === null || cleaned),
          ended: request.terminal && cleaned,
        };
      });
    },
    async mediaReconcileProgress(sessionId: string) {
      const [session] = await input.database
        .select({
          servedVersion: mediaSessions.reconcileServedVersion,
          unsafeAt: mediaSessions.unsafeAt,
          endedAt: mediaSessions.endedAt,
        })
        .from(mediaSessions)
        .where(eq(mediaSessions.id, mediaId(sessionId)));
      if (!session) throw createAppError('NOT_FOUND');
      return session;
    },
    async activeMediaSessions() {
      return input.database
        .select({ id: mediaSessions.id, roundId: mediaSessions.roundId })
        .from(mediaSessions)
        .where(isNull(mediaSessions.endedAt));
    },
  };
}
