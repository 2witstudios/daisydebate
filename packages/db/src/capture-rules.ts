import { createAppError, createRefusal } from '@daisy/errors';
import { captureDigest } from './capture-input';

/** A clip is keyed by its position and its body by every captured field. */
export function clipDigests(clip: {
  readonly roundId: string;
  readonly segmentId: string;
  readonly roundParticipantId: string;
  readonly trackId: string;
  readonly startOffsetMs: number;
  readonly durationMs: number;
  readonly text: string;
  readonly before: string;
  readonly after: string;
}) {
  const clipKey = captureDigest([
    clip.roundId,
    clip.segmentId,
    clip.roundParticipantId,
    clip.trackId,
    clip.startOffsetMs,
  ]);
  return {
    clipKey,
    bodyDigest: captureDigest([
      clipKey,
      clip.durationMs,
      clip.text,
      clip.before,
      clip.after,
    ]),
  };
}

/**
 * A sealed stream accepts only the identical seal again. An open stream never
 * seals below its stored chunks, and its count integrity is checked before timeline eligibility.
 */
export function sealIntegrity(
  stream: {
    readonly state: string;
    readonly chunkCount: number;
    readonly sealedChunkCount: number | null;
  },
  expectedChunkCount: number,
  /** Stored chunks this worker cannot count; each makes the seal partial. */
  uncounted: {
    readonly otherEpochChunks: number;
    readonly framesLost: boolean;
  } = {
    otherEpochChunks: 0,
    framesLost: false,
  },
): 'retry' | 'seal' {
  // A worker counts only the chunks it saw answered. An earlier epoch's are
  // added, and a worker reporting loss may have written one it never heard back
  // about, so it may not reach the stored count. Otherwise it must.
  const reaches = (count: number) =>
    uncounted.framesLost ||
    expectedChunkCount + uncounted.otherEpochChunks >= count;
  if (stream.state !== 'open') {
    const sealed = stream.sealedChunkCount;
    if (sealed === null || expectedChunkCount > sealed || !reaches(sealed))
      throw createAppError('CONFLICT', 'Conflicting capture seal retry');
    return 'retry';
  }
  if (!reaches(stream.chunkCount))
    throw createAppError('CONFLICT', 'Capture seal is below stored chunks');
  return 'seal';
}

export function requireLiveCaptureLease(expiresAt: Date, now: Date): void {
  if (expiresAt <= now)
    throw createRefusal(
      'CONFLICT',
      'lease-expired',
      'Capture worker lease expired',
    );
}
