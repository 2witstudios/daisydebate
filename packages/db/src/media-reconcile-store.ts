import {
  readBroadcastObserverHeld,
  readConversationHeld,
} from './broadcast-operations';
import { revokedBoundSeats, rotateMediaRoom } from './media-session-rotation';
import type { MediaRoomFacts, MediaRoomFate } from '@daisy/protocol';
import {
  readMediaBotLeases,
  mediaHearingSeats,
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
  type MediaWindowRule,
} from './media-session-authority';
import {
  executeLockedRoundTick,
  type LockedRoundTickInput,
} from './round-clock-transaction';
import { hydrateRoundRows, type RoundHydration } from './round-hydration';
import type { RoundCommandAuthority } from '@daisy/protocol';
import {
  withdrawnSeats,
  type ParticipantAdmission,
} from './participant-admission';
import { mediaParticipants } from './schema/media-sessions';
import { sampleRoundExecutionTime } from './round-execution-time';
import { mediaSessions, mediaRoomRotations } from './schema/media-sessions';
import { mediaVendorMutations } from './schema/media-vendor-mutations';
import { rounds } from './schema/rounds';

import {
  proofMatches,
  type MediaVendorIntent,
  type MediaReconcileFence,
  type MediaAbsenceProof,
} from './media-reconcile-contracts';
import { createMediaReconcileClaims } from './media-reconcile-claims';
import {
  MEDIA_RECONCILE_LEASE_MS as LEASE_MS,
  reconcileCompletion,
  requireMutationAdmissible,
  requireReconcileLease,
} from './media-reconcile-rules';

/** Durable serialization only; every provider call happens after these bounded transactions commit. */
export function createMediaReconcileStore(input: {
  readonly database: BunSQLDatabase;
  readonly run: BoundedTransaction;
  readonly nextId: () => string;
}) {
  const pending = (tx: BoundedTransactionContext, sessionId: string) =>
    tx
      .select({
        id: mediaVendorMutations.id,
        dispatchedAt: mediaVendorMutations.dispatchedAt,
      })
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
    const authority = await lockMediaRound(tx, initial.roundId);
    const [session] = await tx
      .select()
      .from(mediaSessions)
      .where(eq(mediaSessions.id, sessionId))
      .for('update');
    if (!session) throw createAppError('NOT_FOUND');
    // The fenced seats travel with the session, so no caller locks twice.
    return {
      ...session,
      seats: authority.participants,
      accounts: authority.accounts,
    };
  };
  const withFence = <T>(
    request: MediaReconcileFence,
    work: (
      tx: BoundedTransactionContext,
      session: Awaited<ReturnType<typeof locked>>,
      now: Date,
    ) => Promise<T>,
  ) =>
    input.run(async (tx) => {
      const session = await locked(tx, request.sessionId);
      const now = new Date(await sampleRoundExecutionTime(tx));
      requireReconcileLease(session, request, now);
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
        /** ADR 0075: participant access, read for every human seat. */
        readonly admits: ParticipantAdmission;
        readonly authorize: (context: {
          readonly conversationHeld: boolean;
          readonly cameraHeld: boolean;
          readonly round: RoundHydration;
          readonly participants: RoundCommandAuthority['participants'];
          /** Bot seats that may hear, floor or not (ISSUE-764). */
          readonly hearing: readonly string[];
          readonly bindings: readonly { readonly roundParticipantId: string }[];
          readonly withdrawn: readonly string[];
          readonly now: string;
          readonly finalSegmentEndedAt: string | null;
          readonly participantId: string | null;
        }) => void;
      },
    ) {
      return withFence(request, async (tx, session) => {
        requireMutationAdmissible(
          session,
          (await pending(tx, session.id)).length,
          request.intent.kind,
        );
        const botLeases = await readMediaBotLeases(
          tx,
          session.roundId,
          session.seats,
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
          conversationHeld: await readConversationHeld(tx, {
            roundId: session.roundId,
          }),
          cameraHeld: await readBroadcastObserverHeld(tx, {
            roundId: session.roundId,
          }),
          bindings: await tx
            .select({
              roundParticipantId: mediaParticipants.roundParticipantId,
            })
            .from(mediaParticipants)
            .where(eq(mediaParticipants.sessionId, session.id)),
          round,
          participants: mediaPublicationParticipants(
            session.seats,
            botLeases,
            round,
            tick.now,
          ),
          hearing: mediaHearingSeats(session.seats, botLeases, round, tick.now),
          withdrawn: withdrawnSeats(
            session.seats,
            session.accounts,
            request.admits,
          ),
          now: tick.now,
          finalSegmentEndedAt: tick.finalSegmentEndedAt,
          participantId,
        });
        const dispatchedAt = new Date(await sampleRoundExecutionTime(tx));
        requireReconcileLease(session, request, dispatchedAt);
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
    /** The mutation horizon, taken BEFORE observing absence: a later intent voids the proof. */
    async prepareMediaAbsenceProof(
      request: MediaReconcileFence,
    ): Promise<MediaAbsenceProof> {
      return withFence(request, async (tx, session) => ({
        ...request,
        mutationHorizon: await mutationCount(tx, session.id),
      }));
    },
    async finishMediaReconcile(
      request: MediaReconcileFence & {
        readonly absenceProof: MediaAbsenceProof | null;
        readonly clean: boolean;
        readonly mediaWindowClosed: MediaWindowRule;
        readonly roomFate: (facts: MediaRoomFacts) => MediaRoomFate;
        /** What this pass read of the room; null if it read nothing. */
        readonly seen: MediaRoomFacts['seen'];
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
        const terminal = request.mediaWindowClosed(
          round.status,
          now.toISOString(),
          round.finalSegmentEndedAt?.toISOString() ?? null,
        );
        const outstanding = await pending(tx, session.id);
        const dispatched = outstanding.map((row) => row.dispatchedAt.getTime());
        const known = session.unsafeAt ? [session.unsafeAt.getTime()] : [];
        const revoked = await revokedBoundSeats(tx, session.id, session.seats);
        const fate = request.roomFate({
          nowMs: now.getTime(),
          terminal,
          ended: session.endedAt !== null,
          absenceProven: proofMatches(
            request.absenceProof,
            request,
            await mutationCount(tx, session.id),
          ),
          seatRevoked: revoked.length > 0,
          uncertainSinceMs:
            dispatched.length + known.length
              ? Math.min(...dispatched, ...known)
              : null,
          lastOccupiedSid: session.roomOccupiedSid,
          sawCapture: session.roomSawCapture,
          seen: request.seen,
        });
        if (fate.kind !== 'keep' && outstanding.length)
          await tx
            .update(mediaVendorMutations)
            .set({ settledAt: now, outcome: 'superseded' })
            .where(
              and(
                eq(mediaVendorMutations.sessionId, session.id),
                isNull(mediaVendorMutations.settledAt),
              ),
            );
        const roomName =
          fate.kind === 'rotate'
            ? await rotateMediaRoom(tx, session.id, revoked, now, input.nextId)
            : undefined;
        const { fields, result } = reconcileCompletion(session, now, {
          terminal,
          unresolved: outstanding.length > 0 && fate.kind === 'keep',
          fate,
          clean: request.clean,
        });
        await tx
          .update(mediaSessions)
          .set({
            ...fields,
            // The one writer of the room watch. A fresh room has been seen by nobody.
            ...(roomName
              ? {
                  roomName,
                  roomOccupiedSid: null,
                  roomSawCapture: false,
                  ...(fate.kind === 'rotate' && fate.cause !== 'seat-revoked'
                    ? { roomRetiredAt: now }
                    : {}),
                }
              : request.seen?.kind === 'absent'
                ? { roomOccupiedSid: null, roomSawCapture: false }
                : request.seen
                  ? {
                      roomOccupiedSid: request.seen.empty
                        ? null
                        : request.seen.sid,
                      roomSawCapture: request.seen.captureListed,
                    }
                  : {}),
          })
          .where(eq(mediaSessions.id, session.id));
        if (roomName)
          await tx.insert(mediaRoomRotations).values({
            id: input.nextId(),
            roundId: session.roundId,
            rotatedAt: now,
          });
        return { ...result, fate };
      });
    },
  };
}
