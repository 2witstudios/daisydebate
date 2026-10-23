import {
  readMediaBotLeases,
  mediaPublicationParticipants,
} from './media-publication-authority';
import { createAppError } from '@daisy/errors';
import { and, count, eq, isNull } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import type { BoundedTransaction } from './bounded-transaction';
import type { BoundedTransactionContext } from './transaction-context';
import {
  lockMediaRound,
  mediaId,
  mediaWindowClosed,
} from './media-session-authority';
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
import { rounds } from './schema/rounds';

type Session = typeof mediaSessions.$inferSelect;
import {
  proofMatches,
  type MediaVendorIntent,
  type MediaReconcileFence,
  type MediaAbsenceProof,
} from './media-reconcile-contracts';
import {
  createMediaReconcileClaims,
  MEDIA_RECONCILE_LEASE_MS as LEASE_MS,
} from './media-reconcile-claims';

const completionFields = (
  session: Session,
  now: Date,
  terminal: boolean,
  cleaned: boolean,
) => ({
  reconcileOwner: null,
  reconcileLeaseUntil: null,
  reconcileCompletedAt: now,
  reconcileServedVersion: session.reconcileRunningVersion,
  // A proven-clean recovery ends the unsafe episode, including its room
  // deletion request, so capture discovery resumes (ISSUE-465).
  ...(cleaned
    ? {
        unsafeAt: null,
        ...(terminal
          ? { endedAt: session.endedAt ?? now }
          : { deletionRequestedAt: null }),
      }
    : {}),
  ...(terminal
    ? { deletionRequestedAt: session.deletionRequestedAt ?? now }
    : {}),
});

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
  const mutationCount = async (
    tx: BoundedTransactionContext,
    sessionId: string,
  ) => {
    const [row] = await tx
      .select({ count: count() })
      .from(mediaVendorMutations)
      .where(eq(mediaVendorMutations.sessionId, sessionId));
    return row!.count;
  };
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
  const withFence = <T>(
    request: MediaReconcileFence,
    work: (
      tx: BoundedTransactionContext,
      session: Session,
      now: Date,
    ) => Promise<T>,
  ) =>
    input.run(async (tx) => {
      const session = await locked(tx, request.sessionId);
      const now = new Date(await sampleRoundExecutionTime(tx));
      fence(session, request, now);
      return work(tx, session, now);
    });
  return {
    ...createMediaReconcileClaims({
      database: input.database,
      run: input.run,
      locked,
      pending,
    }),
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
      return withFence(request, async (tx, session) => {
        const outstanding = await pending(tx, session.id);
        if (
          (session.unsafeAt || outstanding.length) &&
          request.intent.kind !== 'delete'
        )
          throw createAppError('CONFLICT', 'Media recovery is unresolved');
        const authority = await lockMediaRound(tx, session.roundId);
        const botLeases = await readMediaBotLeases(
          tx,
          session.roundId,
          authority.participants,
        );
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
          participants: mediaPublicationParticipants(
            authority.participants,
            botLeases,
            round,
            tick.now,
          ),
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
    /** Only a provider response resolves the dispatched operation: success, or a definite refusal. A rejected network promise is not proof. */
    async settleMediaMutation(id: string, outcome: 'succeeded' | 'failed') {
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
            outcome,
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
    /** Obtain the settled immutable-intent horizon BEFORE observing provider absence. */
    async prepareMediaAbsenceProof(
      request: MediaReconcileFence,
    ): Promise<MediaAbsenceProof | null> {
      return withFence(request, async (tx, session) => {
        if ((await pending(tx, session.id)).length) return null;
        return {
          ...request,
          settledMutationCount: await mutationCount(tx, session.id),
        };
      });
    },
    async finishMediaReconcile(
      request: MediaReconcileFence & {
        readonly absenceProof: MediaAbsenceProof | null;
      },
    ) {
      return withFence(request, async (tx, session, now) => {
        const [round] = await tx
          .select({
            status: rounds.status,
            finalSegmentEndedAt: rounds.finalSegmentEndedAt,
          })
          .from(rounds)
          .where(eq(rounds.id, session.roundId));
        if (!round) throw createAppError('NOT_FOUND');
        const terminal = mediaWindowClosed(
          round.status,
          now.toISOString(),
          round.finalSegmentEndedAt?.toISOString() ?? null,
        );
        const unresolved = (await pending(tx, session.id)).length > 0;
        const cleaned =
          !unresolved &&
          proofMatches(
            request.absenceProof,
            request,
            await mutationCount(tx, session.id),
          );
        await tx
          .update(mediaSessions)
          .set({
            ...completionFields(session, now, terminal, cleaned),
          })
          .where(eq(mediaSessions.id, session.id));
        return {
          safe: !unresolved && (session.unsafeAt === null || cleaned),
          ended: terminal && cleaned,
        };
      });
    },
  };
}
