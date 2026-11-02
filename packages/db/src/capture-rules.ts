import { createAppError } from '@daisy/errors';
import { captureDigest } from './capture-input';
import type { CaptureInterval } from './capture-decisions-port';

type SegmentTiming = {
  readonly startedAt: Date;
  readonly endedAt: Date | null;
  readonly durationMs: number;
};

/** A segment's speaking time ends at its close or its scheduled duration, whichever is first. */
const speakingEnd = (segment: SegmentTiming) =>
  Math.min(
    segment.endedAt?.getTime() ?? Infinity,
    segment.startedAt.getTime() + segment.durationMs,
  );

/**
 * A clip's server bracket must contain its nominal position, lie within one
 * speaking grant, end before the segment does and not be in the future.
 */
export function requireCapturedWindow(
  clip: {
    readonly before: string;
    readonly after: string;
    readonly startOffsetMs: number;
    readonly durationMs: number;
  },
  segment: SegmentTiming,
  now: Date,
  history: readonly CaptureInterval[],
): void {
  const before = Date.parse(clip.before),
    after = Date.parse(clip.after);
  const nominal = segment.startedAt.getTime() + clip.startOffsetMs;
  if (
    before >= after ||
    after > now.getTime() ||
    before > nominal ||
    after < nominal + clip.durationMs ||
    !history.some(
      (grant) =>
        grant.start <= before && (grant.end === null || after < grant.end),
    ) ||
    after >= speakingEnd(segment)
  )
    throw createAppError('CONFLICT', 'Capture window is ineligible');
}

/** An observation lies within one speaking grant, the segment and the past. */
export function requireObservationWindow(
  observation: {
    readonly observedFrom: string;
    readonly observedUntil: string;
  },
  segment: SegmentTiming,
  now: Date,
  required: readonly CaptureInterval[],
): { readonly from: number; readonly until: number } {
  const from = Date.parse(observation.observedFrom),
    until = Date.parse(observation.observedUntil);
  if (
    from >= until ||
    until > now.getTime() ||
    until > speakingEnd(segment) ||
    !required.some(
      (grant) =>
        grant.start <= from && (grant.end === null || until <= grant.end),
    )
  )
    throw createAppError(
      'CONFLICT',
      'Observation is outside capture authority',
    );
  return { from, until };
}

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
 * seals below its stored chunks, nor while its timeline is still open.
 */
export function sealAction(
  stream: {
    readonly state: string;
    readonly chunkCount: number;
    readonly sealedChunkCount: number | null;
  },
  expectedChunkCount: number,
  timeline: {
    readonly segmentEnded: boolean;
    readonly required: readonly CaptureInterval[];
  },
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
  if (
    !timeline.segmentEnded ||
    timeline.required.some((grant) => grant.end === null)
  )
    throw createAppError('CONFLICT', 'Capture timeline is still open');
  return 'seal';
}

/** Capture closes at freeze, at the admission cutoff, or at a terminal Round without one. */
export function captureAdmissionClosed(input: {
  readonly frozen: boolean;
  readonly roundStatus: string | undefined;
  readonly now: string;
  readonly cutoff: string | null;
}): boolean {
  return (
    input.frozen ||
    input.roundStatus === undefined ||
    (input.cutoff !== null && input.now >= input.cutoff) ||
    (input.cutoff === null &&
      ['completed', 'abandoned'].includes(input.roundStatus))
  );
}

export function requireLiveCaptureLease(expiresAt: Date, now: Date): void {
  if (expiresAt <= now)
    throw createAppError('CONFLICT', 'Capture worker lease expired');
}
