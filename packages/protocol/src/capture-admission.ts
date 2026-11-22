import { instantMs } from '@daisy/clock';
import { isRoundOver, type RoundStatus } from './round';
import { speakingEndMs } from './segment-end';
import type { CaptureInterval } from './capture-verdict';

type SegmentTiming = {
  readonly startedAt: Date;
  readonly endedAt: Date | null;
  readonly durationMs: number;
  readonly returnedMs: number;
};

const speakingEnd = (segment: SegmentTiming) =>
  speakingEndMs({
    startedAtMs: segment.startedAt.getTime(),
    endedAtMs: segment.endedAt?.getTime() ?? null,
    durationMs: segment.durationMs,
    returnedMs: segment.returnedMs,
  });

/**
 * A clip's server bracket must contain its nominal position, lie within one
 * speaking grant, end before the segment does and not be in the future.
 */
function capturedWindowAdmits(
  clip: {
    readonly before: string;
    readonly after: string;
    readonly startOffsetMs: number;
    readonly durationMs: number;
  },
  segment: SegmentTiming,
  now: Date,
  history: readonly CaptureInterval[],
): boolean {
  const before = instantMs(clip.before),
    after = instantMs(clip.after);
  const nominal = segment.startedAt.getTime() + clip.startOffsetMs;
  return !(
    before >= after ||
    after > now.getTime() ||
    before > nominal ||
    after < nominal + clip.durationMs ||
    !history.some(
      (grant) =>
        grant.start <= before && (grant.end === null || after < grant.end),
    ) ||
    after >= speakingEnd(segment)
  );
}

/** An observation lies within one speaking grant, the segment and the past. */
function observationWindow(
  observation: {
    readonly observedFrom: string;
    readonly observedUntil: string;
  },
  segment: SegmentTiming,
  now: Date,
  required: readonly CaptureInterval[],
): { readonly from: number; readonly until: number } | null {
  const from = instantMs(observation.observedFrom),
    until = instantMs(observation.observedUntil);
  if (
    from >= until ||
    until > now.getTime() ||
    until > speakingEnd(segment) ||
    !required.some(
      (grant) =>
        grant.start <= from && (grant.end === null || until <= grant.end),
    )
  )
    return null;
  return { from, until };
}

/** Capture closes at freeze, at the admission cutoff, or at a terminal Round without one. */
export function captureAdmissionClosed(input: {
  readonly frozen: boolean;
  readonly roundStatus: RoundStatus | undefined;
  readonly now: string;
  readonly cutoff: string | null;
}): boolean {
  return (
    input.frozen ||
    input.roundStatus === undefined ||
    (input.cutoff !== null && input.now >= input.cutoff) ||
    (input.cutoff === null && isRoundOver(input.roundStatus))
  );
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
function captureSessionAdmits(
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

function sealTimelineAdmits(timeline: {
  readonly segmentEnded: boolean;
  readonly required: readonly CaptureInterval[];
}) {
  return (
    timeline.segmentEnded &&
    !timeline.required.some((grant) => grant.end === null)
  );
}
const receiptAdmits = (until: number, now: Date) => until <= now.getTime();

/** Pure capture eligibility; refusal translation belongs to the application. */
export const captureAdmission = {
  closed: captureAdmissionClosed,
  sessionAdmits: captureSessionAdmits,
  windowAdmits: capturedWindowAdmits,
  observationWindow,
  sealTimelineAdmits,
  receiptAdmits,
};
export type CaptureAdmissionPolicy = {
  readonly closed: typeof captureAdmissionClosed;
  readonly sessionAdmits: typeof captureSessionAdmits;
  readonly requireWindow: (
    ...args: Parameters<typeof capturedWindowAdmits>
  ) => void;
  readonly requireObservation: (
    ...args: Parameters<typeof observationWindow>
  ) => NonNullable<ReturnType<typeof observationWindow>>;
  readonly requireSeal: (
    ...args: Parameters<typeof sealTimelineAdmits>
  ) => void;
  readonly requireAppendReceipt: (
    ...args: Parameters<typeof receiptAdmits>
  ) => void;
  readonly requireObservationReceipt: (
    ...args: Parameters<typeof receiptAdmits>
  ) => void;
};
