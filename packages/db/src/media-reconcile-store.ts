import { addMs } from '@daisy/clock';
import type { DecisionReleasePolicy } from '@daisy/protocol/round-decision-release';
import {
  readBroadcastObserverHeld,
  readConversationHeld,
} from './broadcast-operations';
import { revokedBoundSeats, rotateMediaRoom } from './media-session-rotation';
import type {
  MediaRoomFacts,
  MediaRoomFate,
} from '@daisy/protocol/media-room-fate';
import type { MediaWindowFacts } from '@daisy/protocol/post-round-call';
import {
  readMediaBotLeases,
  mediaHearingSeats,
  mediaPublicationParticipants,
  mediaWithdrawnSeats,
} from './media-publication-authority';
import { createAppError } from '@daisy/errors';
import { and, count, eq, isNull } from 'drizzle-orm';
import type { BoundedTransaction } from './bounded-transaction';
import {
  lockMediaRound,
  mediaId,
  readMediaWindowFacts,
  type MediaWindowRule,
} from './media-session-authority';
import {
  executeLockedRoundTick,
  type LockedRoundTickInput,
} from './round-clock-transaction';
import { hydrateRoundRows, type RoundHydration } from './round-hydration';
import type { RoundCommandAuthority } from '@daisy/protocol/round-command';
import {
  withdrawnSeats,
  type ParticipantAdmission,
} from './participant-admission';
import {
  mediaParticipants,
  mediaSessions,
  mediaRoomRotations,
} from './schema/media-sessions';
import { sampleRoundExecutionTime } from './round-execution-time';
import { mediaVendorMutations } from './schema/media-vendor-mutations';
import { createMediaReconcileClaims } from './media-reconcile-claims';
import type { TxSource, Tx } from './tx';

/** Durable serialization only; every provider call happens after these bounded transactions commit. */
export function createMediaReconcileStore(input: {
  readonly decisionRelease?: DecisionReleasePolicy | undefined;
  readonly database: TxSource;
  readonly run: BoundedTransaction;
  readonly nextId: () => string;
}) {
  const pending = (tx: Tx, sessionId: string) =>
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
  const mutationCount = async (tx: Tx, sessionId: string) => {
    const [row] = await tx
      .select({ count: count() })
      .from(mediaVendorMutations)
      .where(eq(mediaVendorMutations.sessionId, sessionId));
    if (!row) throw createAppError('INVARIANT');
    return row.count;
  };
  const locked = async (tx: Tx, sessionId: string) => {
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
      tx: Tx,
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
          readonly mediaWindow: MediaWindowFacts;
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
          decisionRelease: input.decisionRelease,
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
          mediaWindow: await readMediaWindowFacts(tx, session.roundId, tick),
          withdrawn: mediaWithdrawnSeats(
            withdrawnSeats(session.seats, session.accounts, request.admits),
            round,
          ),
          now: tick.now,
          finalSegmentEndedAt: tick.finalSegmentEndedAt,
          participantId,
        });
        const dispatchedAtIso = await sampleRoundExecutionTime(tx);
        const dispatchedAt = new Date(dispatchedAtIso);
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
            reconcileLeaseUntil: new Date(
              addMs(dispatchedAtIso, MEDIA_RECONCILE_LEASE_MS),
            ),
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
        readonly mediaPhase: MediaWindowRule;
        readonly roomFate: (facts: MediaRoomFacts) => MediaRoomFate;
        /** Since when a post-round call's room has stood empty, after this pass's read. */
        readonly roomVacancy: (
          current: string | null,
          seen: MediaRoomFacts['seen'],
          now: string,
        ) => string | null;
        /** What this pass read of the room; null if it read nothing. */
        readonly seen: MediaRoomFacts['seen'];
      },
    ) {
      return withFence(request, async (tx, session, now) => {
        const stored = await readMediaWindowFacts(tx, session.roundId, {
          now: now.toISOString(),
        });
        // The phase is decided on what this pass saw of the call's room, never on
        // an emptiness stored before it: someone may have come back without a
        // new token, and an occupied call is not closed on them.
        const vacantSince = stored.postRoundCall.vacantSince;
        const nextVacancy =
          stored.postRoundCall.openedAt === null
            ? vacantSince
            : request.roomVacancy(vacantSince, request.seen, now.toISOString());
        const phase = request.mediaPhase({
          ...stored,
          postRoundCall: { ...stored.postRoundCall, vacantSince: nextVacancy },
        });
        const terminal = phase === 'closed';
        const call =
          phase === 'post-round-call-opening'
            ? 'opening'
            : phase === 'post-round-call'
              ? 'open'
              : 'none';
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
          call,
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
        // The call's room is a fresh one too: the worker lease is fenced with it.
        const roomName =
          fate.kind === 'rotate' || fate.kind === 'open-post-round-call'
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
            ...(fate.kind === 'open-post-round-call'
              ? { postRoundCallOpenedAt: now, roomVacantSince: now }
              : call !== 'open'
                ? {}
                : roomName
                  ? // A fresh room has been seen by nobody: its vacancy starts now.
                    { roomVacantSince: now }
                  : nextVacancy !== vacantSince
                    ? {
                        roomVacantSince:
                          nextVacancy === null ? null : new Date(nextVacancy),
                      }
                    : {}),
            // The one writer of the room watch. A fresh room has been seen by nobody.
            ...(roomName
              ? { roomName, roomOccupiedSid: null, roomSawCapture: false }
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
        if (roomName && fate.kind === 'rotate')
          await tx.insert(mediaRoomRotations).values({
            id: input.nextId(),
            roundId: session.roundId,
            rotatedAt: now,
            cause: fate.cause,
          });
        return { ...result, fate };
      });
    },
  };
}

export const MEDIA_RECONCILE_LEASE_MS = 15_000;
const MIN_RECONCILE_MS = 500;
// The ISO database clock rounds down to milliseconds; preserve the full minimum interval.
const CLOCK_PRECISION_MS = 1;

/**
 * A reconcile holds the session only while its owner's lease is unexpired at
 * `now`, the database clock; an aborted run's owner blocks nothing.
 */
export const reconcileLive = <
  S extends {
    readonly reconcileOwner: string | null;
    readonly reconcileLeaseUntil: Date | null;
  },
>(
  session: S,
  now: Date,
): session is S & { readonly reconcileLeaseUntil: Date } =>
  session.reconcileOwner !== null &&
  session.reconcileLeaseUntil !== null &&
  session.reconcileLeaseUntil > now;

/**
 * Wait for a live owner and the minimum interval since the last run, else
 * claim the next epoch; outstanding vendor work makes the session unsafe.
 */
export function reconcileClaim(
  session: {
    readonly reconcileOwner: string | null;
    readonly reconcileLeaseUntil: Date | null;
    readonly reconcileStartedAt: Date | null;
    readonly reconcileEpoch: number;
    readonly reconcileRequestVersion: number;
    readonly unsafeAt: Date | null;
  },
  now: Date,
  outstanding: boolean,
) {
  if (reconcileLive(session, now))
    return {
      kind: 'wait' as const,
      reason: 'lease' as const,
      retryAt: session.reconcileLeaseUntil.toISOString(),
    };
  const earliest =
    (session.reconcileStartedAt?.getTime() ?? -Infinity) +
    MIN_RECONCILE_MS +
    CLOCK_PRECISION_MS;
  if (now.getTime() < earliest)
    return {
      kind: 'wait' as const,
      reason: 'interval' as const,
      retryAt: new Date(earliest).toISOString(),
    };
  return {
    kind: 'claim' as const,
    epoch: session.reconcileEpoch + 1,
    leaseUntil: new Date(now.getTime() + MEDIA_RECONCILE_LEASE_MS),
    runningVersion: session.reconcileRequestVersion,
    unsafeAt: session.unsafeAt ?? (outstanding ? now : null),
  };
}

/** Only the current owner and epoch act, and only inside a live lease. */
export function requireReconcileLease(
  session: {
    readonly reconcileOwner: string | null;
    readonly reconcileEpoch: number;
    readonly reconcileLeaseUntil: Date | null;
  },
  claim: MediaReconcileFence,
  now: Date,
) {
  if (
    session.reconcileOwner !== claim.owner ||
    session.reconcileEpoch !== claim.epoch ||
    !session.reconcileLeaseUntil ||
    session.reconcileLeaseUntil <= now
  )
    throw createAppError('CONFLICT', 'Media reconciliation lease changed');
}

/** Unresolved vendor state admits only teardown, never wider access. */
export function requireMutationAdmissible(
  session: { readonly unsafeAt: Date | null },
  outstanding: number,
  kind: MediaVendorIntent['kind'],
) {
  if ((session.unsafeAt || outstanding) && kind !== 'delete')
    throw createAppError('CONFLICT', 'Media recovery is unresolved');
}

/**
 * Release the lease and serve the running version, applying the pass's room fate. A
 * terminal session requests deletion. Any fate but `keep` ends the unsafe episode, and
 * on an open Round clears the deletion request so capture discovery resumes (ISSUE-465).
 */
export function reconcileCompletion(
  session: {
    readonly reconcileRunningVersion: number;
    readonly endedAt: Date | null;
    readonly deletionRequestedAt: Date | null;
    readonly unsafeAt: Date | null;
  },
  now: Date,
  outcome: {
    readonly terminal: boolean;
    /** Vendor work still pending after this pass's decision. */
    readonly unresolved: boolean;
    readonly fate: MediaRoomFate;
    /** The pass finished its work; a failed one leaves the Round due to the tick. */
    readonly clean: boolean;
  },
) {
  const { terminal, unresolved, fate, clean } = outcome;
  const settled = fate.kind !== 'keep';
  return {
    fields: {
      reconcileOwner: null,
      reconcileLeaseUntil: null,
      reconcileCompletedAt: now,
      reconcileLastPassClean: clean,
      reconcileServedVersion: session.reconcileRunningVersion,
      ...(settled ? { unsafeAt: null } : {}),
      ...(fate.kind === 'end' ? { endedAt: session.endedAt ?? now } : {}),
      ...(fate.kind === 'rotate' ||
      fate.kind === 'clear' ||
      fate.kind === 'open-post-round-call'
        ? { deletionRequestedAt: null }
        : {}),
      ...(terminal
        ? { deletionRequestedAt: session.deletionRequestedAt ?? now }
        : {}),
    },
    result: {
      safe: !unresolved && (session.unsafeAt === null || settled),
      ended: fate.kind === 'end',
    },
  };
}
export type MediaVendorIntent =
  | {
      readonly kind: 'create' | 'delete';
      readonly identity: null;
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
export type MediaAbsenceProof = MediaReconcileFence & {
  readonly mutationHorizon: number;
};
export const proofMatches = (
  proof: MediaAbsenceProof | null,
  fence: MediaReconcileFence,
  mutations: number,
) =>
  proof !== null &&
  proof.sessionId === fence.sessionId &&
  proof.owner === fence.owner &&
  proof.epoch === fence.epoch &&
  proof.mutationHorizon === mutations;
