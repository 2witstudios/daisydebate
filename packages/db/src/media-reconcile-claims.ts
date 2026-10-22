import { createAppError } from '@daisy/errors';
import { eq, isNull } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import type { BoundedTransaction } from './bounded-transaction';
import type { BoundedTransactionContext } from './transaction-context';
import { lockMediaRound, mediaId } from './media-session-authority';
import { sampleRoundExecutionTime } from './round-execution-time';
import { mediaSessions } from './schema/media-sessions';
export const MEDIA_RECONCILE_LEASE_MS = 15_000;
const MIN_RECONCILE_MS = 500;
const CLOCK_PRECISION_MS = 1;
export function createMediaReconcileClaims(deps: {
  readonly database: BunSQLDatabase;
  readonly run: BoundedTransaction;
  readonly locked: (
    tx: BoundedTransactionContext,
    sessionId: string,
  ) => Promise<typeof mediaSessions.$inferSelect>;
  readonly pending: (
    tx: BoundedTransactionContext,
    sessionId: string,
  ) => Promise<readonly { readonly id: string }[]>;
}) {
  return {
    async requestMediaReconcile(request: {
      readonly roundId: string;
      readonly actorId?: string;
    }) {
      return deps.run(async (tx) => {
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
      return deps.run(async (tx) => {
        const session = await deps.locked(tx, request.sessionId);
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
        // The ISO database clock rounds down to milliseconds; preserve the full minimum interval.
        const earliest =
          (session.reconcileStartedAt?.getTime() ?? -Infinity) +
          MIN_RECONCILE_MS +
          CLOCK_PRECISION_MS;
        if (now.getTime() < earliest)
          return {
            kind: 'wait' as const,
            retryAt: new Date(earliest).toISOString(),
          };
        const outstanding = await deps.pending(tx, session.id);
        const epoch = session.reconcileEpoch + 1;
        const unsafeAt = session.unsafeAt ?? (outstanding.length ? now : null);
        await tx
          .update(mediaSessions)
          .set({
            reconcileEpoch: epoch,
            reconcileOwner: request.owner,
            reconcileLeaseUntil: new Date(
              now.getTime() + MEDIA_RECONCILE_LEASE_MS,
            ),
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
    async mediaReconcileProgress(sessionId: string) {
      const [session] = await deps.database
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
      return deps.database
        .select({ id: mediaSessions.id, roundId: mediaSessions.roundId })
        .from(mediaSessions)
        .where(isNull(mediaSessions.endedAt));
    },
  };
}
