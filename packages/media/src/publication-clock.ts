import type { ClockCalibration } from '@daisy/protocol';

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
type ClockRejection = CalibrationRejection;
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
