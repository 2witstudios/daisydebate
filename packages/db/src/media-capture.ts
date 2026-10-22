import { createAppError } from '@daisy/errors';
import { eq, sql } from 'drizzle-orm';
import {
  captureClipSchema,
  captureReadSchema,
  captureWorkerIdentitySchema,
  captureLeaseSchema,
  captureLeaseCheckSchema,
  captureObservationSchema,
  captureSealSchema,
  parseCapture,
} from './capture-input';
import {
  captureAdmission,
  lockCaptureRound,
  validCaptureIds,
  type CaptureDependencies,
} from './media-capture-context';
import { mediaWorkerLeases } from './schema/transcript-segments';
import { readMediaCaptureState } from './media-capture-read';
import { verifyMediaWorkerLease } from './media-worker-lease';
import { appendCapturedTranscript } from './captured-transcript';
import { observeCapturedStream, sealCapturedStream } from './capture-stream';

/** Internal composition: inject the existing pool's actual bounded transaction. */
export const mediaCaptureOperations = (dependencies: CaptureDependencies) => ({
  readMediaCaptureState(raw: unknown) {
    const input = parseCapture(captureReadSchema, raw);
    return dependencies.transaction((tx) =>
      readMediaCaptureState(tx, input, dependencies),
    );
  },
  /**
   * Unlocked witness for an already admitted activity seat: the lease is
   * current and its segment still open. Returns fresh PostgreSQL time.
   */
  readCurrentCaptureLease(raw: unknown) {
    const input = parseCapture(captureLeaseCheckSchema, raw);
    return dependencies.transaction(async (tx) => {
      const [row] = (await tx.execute(sql`
        select to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "serverNow"
        from media_worker_leases l
        join media_sessions s on s.id=l.session_id
        join round_segments g on g.round_id=s.round_id
        where l.session_id=${input.sessionId} and s.round_id=${input.roundId}
          and l.worker_id=${input.workerId} and l.epoch=${input.epoch}
          and l.expires_at>clock_timestamp()
          and s.ended_at is null and s.unsafe_at is null
          and g.id=${input.segmentId} and g.ended_at is null`)) as unknown as {
        serverNow: string;
      }[];
      if (!row)
        throw createAppError('CONFLICT', 'Capture worker lease is stale');
      return row;
    });
  },
  verifyMediaWorkerLease(raw: unknown) {
    const input = parseCapture(captureWorkerIdentitySchema, raw);
    return dependencies.transaction((tx) =>
      verifyMediaWorkerLease(tx, input, dependencies),
    );
  },
  async claimMediaWorkerLease(raw: unknown) {
    const input = parseCapture(captureLeaseSchema, raw);
    return dependencies.transaction(async (tx) => {
      const tick = await lockCaptureRound(tx, input, dependencies);
      validCaptureIds(input.workerId);
      const [current] = await tx
        .select()
        .from(mediaWorkerLeases)
        .where(eq(mediaWorkerLeases.sessionId, input.sessionId))
        .for('update');
      const now = await captureAdmission(
        tx,
        input.roundId,
        tick.transcriptAdmissionCutoff,
      );
      if (
        current &&
        current.workerId !== input.workerId &&
        current.expiresAt > now
      )
        throw createAppError('CONFLICT', 'Capture worker lease is held');
      const epoch = !current
        ? 1
        : current.expiresAt > now
          ? current.epoch
          : current.epoch + 1;
      if (epoch > 2147483647)
        throw createAppError('CONFLICT', 'Capture worker epoch exhausted');
      const expiresAt = new Date(now.getTime() + input.leaseMs);
      await tx
        .insert(mediaWorkerLeases)
        .values({
          sessionId: input.sessionId,
          workerId: input.workerId,
          epoch,
          expiresAt,
        })
        .onConflictDoUpdate({
          target: mediaWorkerLeases.sessionId,
          set: { workerId: input.workerId, epoch, expiresAt },
        });
      return { epoch, expiresAt: expiresAt.toISOString() };
    });
  },
  appendCapturedTranscript(raw: unknown) {
    const input = parseCapture(captureClipSchema, raw);
    return dependencies.transaction((tx) =>
      appendCapturedTranscript(tx, input, dependencies),
    );
  },
  observeCapturedStream(raw: unknown) {
    const input = parseCapture(captureObservationSchema, raw);
    return dependencies.transaction((tx) =>
      observeCapturedStream(tx, input, dependencies),
    );
  },
  sealCapturedStream(raw: unknown) {
    const input = parseCapture(captureSealSchema, raw);
    return dependencies.transaction((tx) =>
      sealCapturedStream(tx, input, dependencies),
    );
  },
});
