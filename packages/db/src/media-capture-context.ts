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
  readonly nextId: () => string;
  readonly buildProjection: LockedRoundTickInput['buildProjection'];
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
    freeze ||
    !round ||
    (cutoff !== null && now >= cutoff) ||
    (cutoff === null && ['completed', 'abandoned'].includes(round.status))
  )
    throw createAppError('CONFLICT', 'Capture admission is closed');
  return new Date(now);
}
type CaptureSessionClose = {
  readonly endedAt: Date | null;
  readonly unsafeAt: Date | null;
  readonly deletionRequestedAt: Date | null;
};
/**
 * The one capture-time rule for a session (CAP-E.1-r6): a deletion request
 * admits nothing, since that is erasure; after the session ends or turns
 * unsafe, only audio captured strictly before that instant is admitted, for
 * speech-to-text that runs behind it. Work with no capture time (reads, seals)
 * is refused only by a deletion request.
 */
export function captureSessionAdmits(
  session: CaptureSessionClose,
  capturedUntil?: Date,
) {
  if (session.deletionRequestedAt) return false;
  if (capturedUntil === undefined) return true;
  const closes = [session.endedAt, session.unsafeAt].flatMap((at) =>
    at ? [at.getTime()] : [],
  );
  return closes.length === 0 || capturedUntil.getTime() < Math.min(...closes);
}
/** Refuses work the session no longer admits; shares the Round lock already held. */
export async function requireCaptureSession(
  tx: CaptureTx,
  input: { readonly sessionId: string },
  capturedUntil?: Date,
) {
  const [session] = await tx
    .select({
      endedAt: mediaSessions.endedAt,
      unsafeAt: mediaSessions.unsafeAt,
      deletionRequestedAt: mediaSessions.deletionRequestedAt,
    })
    .from(mediaSessions)
    .where(eq(mediaSessions.id, input.sessionId));
  if (!session || !captureSessionAdmits(session, capturedUntil))
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
  await tx
    .insert(transcriptSegments)
    .values({
      roundId: input.roundId,
      segmentId: input.segmentId,
      roundParticipantId: input.roundParticipantId,
    })
    .onConflictDoNothing();
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
  return { segment, stream };
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
  await requireCaptureSession(tx, input, capturedUntil);
  const stream = await lockCaptureStream(tx, input);
  const now = await captureAdmission(
    tx,
    input.roundId,
    tick.transcriptAdmissionCutoff,
  );
  if (lease.expiresAt <= now)
    throw createAppError('CONFLICT', 'Capture worker lease expired');
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
  if (context.leaseExpiresAt <= now)
    throw createAppError('CONFLICT', 'Capture worker lease expired');
  return now;
}
