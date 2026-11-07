import type { SourceProgress } from './audio-publication';

export type ClockCalibration = {
  readonly sentAtMs: number;
  readonly receivedAtMs: number;
  readonly serverNowMs: number;
  readonly precisionMs?: number;
};
type ClockFields = {
  readonly calibration: ClockCalibration;
  readonly anchorMs: number;
  readonly sampleRate: number;
  readonly eligibleSamples: number;
};
type CalibrationRejection =
  | 'calibration.nonfinite'
  | 'calibration.sample-rate'
  | 'calibration.rtt-order'
  | 'calibration.rtt-limit'
  | 'calibration.precision-order'
  | 'calibration.precision-limit'
  | 'calibration.anchor-order';
type ClockRejection =
  | CalibrationRejection
  | 'receipt.nonfinite'
  | 'receipt.noncontiguous'
  | 'receipt.frame-size'
  | 'receipt.early'
  | 'receipt.reversed'
  | 'receipt.late'
  | 'receipt.before-calibration'
  | 'receipt.stale'
  | 'refresh.age-order'
  | 'refresh.request-order'
  | 'refresh.stale'
  | 'refresh.offset-ahead'
  | 'refresh.offset-behind';
type PublicationClock = ClockFields &
  (
    | { readonly valid: true }
    | { readonly valid: false; readonly rejection: ClockRejection }
  );

/** The first rejected predicate is evidence; a later snapshot cannot rename it. */
function decide(
  fields: ClockFields,
  rejection: ClockRejection | null,
): PublicationClock {
  const clock = {
    calibration: fields.calibration,
    anchorMs: fields.anchorMs,
    sampleRate: fields.sampleRate,
    eligibleSamples: fields.eligibleSamples,
  };
  return rejection === null
    ? { ...clock, valid: true }
    : { ...clock, valid: false, rejection };
}

function calibrationRejection(
  calibration: ClockCalibration,
  anchorMs: number,
  sampleRate: number,
): CalibrationRejection | null {
  const rtt = calibration.receivedAtMs - calibration.sentAtMs;
  if (![anchorMs, ...Object.values(calibration)].every(Number.isFinite))
    return 'calibration.nonfinite';
  if (![16000, 24000, 48000].includes(sampleRate))
    return 'calibration.sample-rate';
  if (rtt < 0) return 'calibration.rtt-order';
  if (rtt > 100) return 'calibration.rtt-limit';
  if ((calibration.precisionMs ?? 0) < 0) return 'calibration.precision-order';
  if ((calibration.precisionMs ?? 0) > 1) return 'calibration.precision-limit';
  return anchorMs < calibration.receivedAtMs
    ? 'calibration.anchor-order'
    : null;
}

export function publicationClock(input: {
  readonly calibration: ClockCalibration;
  readonly anchorMs: number;
  readonly sampleRate: number;
}): PublicationClock {
  const { calibration, anchorMs, sampleRate } = input;
  return decide(
    { ...input, eligibleSamples: 0 },
    calibrationRejection(calibration, anchorMs, sampleRate),
  );
}

/**
 * Covers the full nominal 10ms cadence period and the actual native handoff
 * bracket. It never assigns a point timestamp or treats raw count as duration.
 * A gap permanently invalidates this publication anchor.
 */
export function observeSourceProgress(
  clock: PublicationClock,
  receipt: SourceProgress,
): {
  readonly clock: PublicationClock;
  readonly window: {
    readonly beforeMs: number;
    readonly afterMs: number;
  } | null;
} {
  const frameSamples = clock.sampleRate / 100;
  const periodStart =
    clock.anchorMs + (clock.eligibleSamples / clock.sampleRate) * 1000;
  const due = periodStart + 10;
  const age = receipt.afterMs - clock.calibration.receivedAtMs;
  const reject = (rejection: ClockRejection) => ({
    clock: decide(clock, rejection),
    window: null,
  });
  if (!clock.valid) return reject(clock.rejection);
  if (!Object.values(receipt).every(Number.isFinite))
    return reject('receipt.nonfinite');
  if (receipt.startSample !== clock.eligibleSamples)
    return reject('receipt.noncontiguous');
  if (receipt.endSample - receipt.startSample !== frameSamples)
    return reject('receipt.frame-size');
  if (receipt.beforeMs < due) return reject('receipt.early');
  if (receipt.afterMs < receipt.beforeMs) return reject('receipt.reversed');
  if (receipt.afterMs - due > 100) return reject('receipt.late');
  if (age < 0) return reject('receipt.before-calibration');
  if (age > 30000) return reject('receipt.stale');
  const offsets = calibrationOffsets(
    clock.calibration,
    periodStart,
    receipt.afterMs,
  );
  return {
    clock: decide({ ...clock, eligibleSamples: receipt.endSample }, null),
    window: {
      beforeMs: periodStart + offsets.lower,
      afterMs: receipt.afterMs + offsets.upper,
    },
  };
}

/**
 * After a stall before a frame was sent: the next period starts at `nowMs` on
 * a fresh calibration and the sent samples keep their count, so no window
 * covers the stalled time. A receipt gap is not a stall and stays invalid.
 */
export function reanchorPublicationClock(
  clock: PublicationClock,
  calibration: ClockCalibration,
  nowMs: number,
): PublicationClock {
  const fresh = publicationClock({
    calibration,
    anchorMs: nowMs,
    sampleRate: clock.sampleRate,
  });
  return decide(
    {
      ...fresh,
      anchorMs: nowMs - (clock.eligibleSamples / clock.sampleRate) * 1000,
      eligibleSamples: clock.eligibleSamples,
    },
    !clock.valid ? clock.rejection : !fresh.valid ? fresh.rejection : null,
  );
}

/** Refresh offsets without manufacturing a new sample anchor after a gap. */
export function refreshPublicationClock(
  clock: PublicationClock,
  calibration: ClockCalibration,
): PublicationClock {
  const age = calibration.receivedAtMs - clock.calibration.receivedAtMs;
  const checked = publicationClock({
    calibration,
    anchorMs: calibration.receivedAtMs,
    sampleRate: clock.sampleRate,
  });
  const previous = calibrationOffsets(
    clock.calibration,
    calibration.sentAtMs,
    calibration.receivedAtMs,
  );
  const next = calibrationOffsets(
    calibration,
    calibration.sentAtMs,
    calibration.receivedAtMs,
  );
  const reject = (rejection: ClockRejection) =>
    decide({ ...clock, calibration }, rejection);
  if (!clock.valid) return reject(clock.rejection);
  if (!checked.valid) return reject(checked.rejection);
  if (!(age >= 0)) return reject('refresh.age-order');
  if (!(calibration.sentAtMs >= clock.calibration.receivedAtMs))
    return reject('refresh.request-order');
  if (!(age <= 30000)) return reject('refresh.stale');
  if (!(next.lower <= previous.upper)) return reject('refresh.offset-ahead');
  if (!(next.upper >= previous.lower)) return reject('refresh.offset-behind');
  return decide({ ...clock, calibration }, null);
}

export function calibrationOffsets(
  calibration: ClockCalibration,
  start: number,
  end: number,
) {
  // The database sample may be anywhere in the request bracket. Bound both
  // frame endpoints against both possible calibration endpoints, including
  // periods that began before a refreshed calibration.
  const drift =
    Math.max(
      Math.abs(start - calibration.sentAtMs),
      Math.abs(start - calibration.receivedAtMs),
      Math.abs(end - calibration.sentAtMs),
      Math.abs(end - calibration.receivedAtMs),
    ) * 0.0001;
  return {
    lower: calibration.serverNowMs - calibration.receivedAtMs - drift,
    upper:
      calibration.serverNowMs -
      calibration.sentAtMs +
      drift +
      (calibration.precisionMs ?? 0),
  };
}
