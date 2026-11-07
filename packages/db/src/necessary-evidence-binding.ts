import { captureDigest } from './capture-input';
import type { z } from 'zod';
import type { captureEvidenceIntentSchema } from './capture-input';
type Intent = z.infer<typeof captureEvidenceIntentSchema>;
/** Binds server-validated original scope/window independently of the declared full-body digest. */
export const originalEvidenceBinding = (
  input: Intent,
  subjects: readonly string[],
) =>
  captureDigest([
    'necessary-evidence@1',
    input.roundId,
    input.sessionId,
    input.segmentId,
    input.roundParticipantId,
    input.workerId,
    input.epoch,
    input.trackId,
    input.startOffsetMs,
    input.durationMs,
    input.before,
    input.after,
    input.bodyDigest,
    input.reservedBytes,
    subjects,
  ]);
