import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { and, eq } from 'drizzle-orm';
import type { BoundedTransaction } from './bounded-transaction';
import type { BoundedTransactionContext } from './transaction-context';
import {
  executeLockedRoundTick,
  type LockedRoundTickInput,
} from './round-clock-transaction';
import { sampleRoundExecutionTime } from './round-execution-time';
import { mediaSessions } from './schema/media-sessions';
import { roundTranscriptFreezes } from './schema/round-transcript-freezes';
import {
  mediaWorkerLeases,
  transcriptSegments,
} from './schema/transcript-segments';
import { rounds } from './schema/rounds';
import { roundSegments } from './schema/round-segments';
import {
  captureAdmissionClosed,
  requireLiveCaptureLease,
} from './capture-rules';

export type CaptureIdentity = {
  readonly roundId: string;
  readonly sessionId: string;
  readonly workerId: string;
  readonly epoch: number;
};
export type CaptureStream = {
  readonly segmentId: string;
  readonly roundParticipantId: string;
};
export type CaptureDependencies = {
  readonly transaction: BoundedTransaction;
  /** Injected policy: how long after a session closes earlier audio may still arrive (CAP-E.1-r8). */
  readonly sttLagMs: number;
  /** Injected policy: how far required coverage may move to captured frames (DEC-218, DEC-220). */
  readonly coverageTolerance: CoverageTolerance;
  readonly nextId: () => string;
  readonly buildProjection: LockedRoundTickInput['buildProjection'];
};
export type CoverageTolerance = {
  readonly joinMs: number;
  readonly relayMs: number;
};
export type CaptureTx = BoundedTransactionContext;
export const validCaptureIds = (...ids: readonly string[]) => {
  if (!ids.every((id) => idSchema.safeParse(id).success))
    throw createAppError('VALIDATION');
};
export async function lockCaptureRound(
  tx: CaptureTx,
  input: { readonly roundId: string; readonly sessionId: string },
  dependencies: CaptureDependencies,
) {
  validCaptureIds(input.roundId, input.sessionId);
  const tick = await executeLockedRoundTick(tx, {
    roundId: input.roundId,
    buildProjection: dependencies.buildProjection,
  });
  const [session] = await tx
    .select({ id: mediaSessions.id })
    .from(mediaSessions)
    .where(
      and(
        eq(mediaSessions.id, input.sessionId),
        eq(mediaSessions.roundId, input.roundId),
      ),
    );
  if (!session) throw createAppError('NOT_FOUND');
  return tick;
}
export async function captureAdmission(
  tx: CaptureTx,
  roundId: string,
  cutoff: string | null,
) {
  const [freeze] = await tx
    .select({ id: roundTranscriptFreezes.roundId })
    .from(roundTranscriptFreezes)
    .where(eq(roundTranscriptFreezes.roundId, roundId));
  const [round] = await tx
    .select({ status: rounds.status })
    .from(rounds)
    .where(eq(rounds.id, roundId));
  const now = await sampleRoundExecutionTime(tx);
  if (
    captureAdmissionClosed({
      frozen: freeze !== undefined,
      roundStatus: round?.status,
      now,
      cutoff,
    })
  )
    throw createAppError('CONFLICT', 'Capture admission is closed');
  return new Date(now);
}
type CaptureSessionClose = {
  readonly endedAt: Date | null;
  readonly unsafeAt: Date | null;
  readonly deletionRequestedAt: Date | null;
};
/** A write's worker capture stamp, its database receipt time and the lag policy. */
export type CaptureWriteTiming = {
  readonly capturedUntil: Date;
  readonly receivedAt: Date;
  readonly sttLagMs: number;
};
/**
 * The one capture-time rule for a session (CAP-E.1-r6, CAP-E.1-r8). Ending,
 * turning unsafe and a vendor-room deletion request each close it; the
 * deletion request is not data erasure, which is Round deletion. After the
 * earliest close, a write is admitted only if its audio was captured strictly
 * before that instant and it reached the database within the speech-to-text
 * lag after it; the worker stamp alone never admits late audio. Work with no
 * capture time (reads, seals) is admitted.
 */
export function captureSessionAdmits(
  session: CaptureSessionClose,
  write?: CaptureWriteTiming,
) {
  if (write === undefined) return true;
  const closes = [
    session.endedAt,
    session.unsafeAt,
    session.deletionRequestedAt,
  ].flatMap((at) => (at ? [at.getTime()] : []));
  if (closes.length === 0) return true;
  const closedAt = Math.min(...closes);
  return (
    write.capturedUntil.getTime() < closedAt &&
    write.receivedAt.getTime() <= closedAt + write.sttLagMs
  );
}
/** Refuses work the session no longer admits; shares the Round lock already held. */
export async function requireCaptureSession(
  tx: CaptureTx,
  input: { readonly sessionId: string },
  write?: CaptureWriteTiming,
) {
  const [session] = await tx
    .select({
      endedAt: mediaSessions.endedAt,
      unsafeAt: mediaSessions.unsafeAt,
      deletionRequestedAt: mediaSessions.deletionRequestedAt,
    })
    .from(mediaSessions)
    .where(eq(mediaSessions.id, input.sessionId));
  if (!session || !captureSessionAdmits(session, write))
    throw createAppError('CONFLICT', 'Capture session is closed');
}
export async function lockCaptureLease(tx: CaptureTx, input: CaptureIdentity) {
  validCaptureIds(input.workerId);
  if (!Number.isSafeInteger(input.epoch) || input.epoch < 1)
    throw createAppError('VALIDATION');
  const [lease] = await tx
    .select()
    .from(mediaWorkerLeases)
    .where(eq(mediaWorkerLeases.sessionId, input.sessionId))
    .for('update');
  if (
    !lease ||
    lease.workerId !== input.workerId ||
    lease.epoch !== input.epoch
  )
    throw createAppError('CONFLICT', 'Capture worker lease is stale');
  return lease;
}
async function lockCaptureStream(
  tx: CaptureTx,
  input: CaptureIdentity & CaptureStream,
) {
  validCaptureIds(input.segmentId, input.roundParticipantId);
  const [segment] = await tx
    .select()
    .from(roundSegments)
    .where(
      and(
        eq(roundSegments.id, input.segmentId),
        eq(roundSegments.roundId, input.roundId),
      ),
    )
    .for('update');
  if (!segment) throw createAppError('NOT_FOUND');
  const created = await tx
    .insert(transcriptSegments)
    .values({
      roundId: input.roundId,
      segmentId: input.segmentId,
      roundParticipantId: input.roundParticipantId,
    })
    .onConflictDoNothing()
    .returning({ segmentId: transcriptSegments.segmentId });
  const [stream] = await tx
    .select()
    .from(transcriptSegments)
    .where(
      and(
        eq(transcriptSegments.segmentId, input.segmentId),
        eq(transcriptSegments.roundParticipantId, input.roundParticipantId),
      ),
    )
    .for('update');
  if (!stream || stream.roundId !== input.roundId)
    throw createAppError('CONFLICT');
  return { segment, stream, created: created.length > 0 };
}
export async function captureWriteContext(
  tx: CaptureTx,
  input: CaptureIdentity & CaptureStream,
  dependencies: CaptureDependencies,
  /** The end of the audio this write records; none for a seal. */
  capturedUntil?: Date,
) {
  const tick = await lockCaptureRound(tx, input, dependencies);
  const lease = await lockCaptureLease(tx, input);
  const stream = await lockCaptureStream(tx, input);
  const now = await captureAdmission(
    tx,
    input.roundId,
    tick.transcriptAdmissionCutoff,
  );
  await requireCaptureSession(
    tx,
    input,
    capturedUntil && {
      capturedUntil,
      receivedAt: now,
      sttLagMs: dependencies.sttLagMs,
    },
  );
  requireLiveCaptureLease(lease.expiresAt, now);
  return {
    ...stream,
    now,
    cutoff: tick.transcriptAdmissionCutoff,
    leaseExpiresAt: lease.expiresAt,
  };
}

/** Resample after evidence reads, immediately before the durable mutation. */
export async function freshCaptureMutation(
  tx: CaptureTx,
  roundId: string,
  context: {
    readonly cutoff: string | null;
    readonly leaseExpiresAt: Date;
  },
) {
  const now = await captureAdmission(tx, roundId, context.cutoff);
  requireLiveCaptureLease(context.leaseExpiresAt, now);
  return now;
}
