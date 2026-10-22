import { createAppError } from '@daisy/errors';
import { eq } from 'drizzle-orm';
import {
  captureClipSchema,
  captureLeaseSchema,
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
import { appendCapturedTranscript } from './captured-transcript';
import { observeCapturedStream, sealCapturedStream } from './capture-stream';

/** Internal composition: inject the existing pool's actual bounded transaction. */
export const mediaCaptureOperations = (dependencies: CaptureDependencies) => ({
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
