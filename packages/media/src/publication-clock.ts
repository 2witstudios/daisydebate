import type { SourceProgress } from './audio-publication';

export type ClockCalibration = {
  readonly sentAtMs: number;
  readonly receivedAtMs: number;
  readonly serverNowMs: number;
  readonly precisionMs?: number;
};
type PublicationClock = {
  readonly calibration: ClockCalibration;
  readonly anchorMs: number;
  readonly sampleRate: number;
  readonly eligibleSamples: number;
  readonly valid: boolean;
};

export function publicationClock(input: {
  readonly calibration: ClockCalibration;
  readonly anchorMs: number;
  readonly sampleRate: number;
}): PublicationClock {
  const { calibration, anchorMs, sampleRate } = input;
  const rtt = calibration.receivedAtMs - calibration.sentAtMs;
  return {
    ...input,
    eligibleSamples: 0,
    valid:
      [anchorMs, ...Object.values(calibration)].every(Number.isFinite) &&
      [24000, 48000].includes(sampleRate) &&
      rtt >= 0 &&
      rtt <= 100 &&
      (calibration.precisionMs ?? 0) >= 0 &&
      (calibration.precisionMs ?? 0) <= 1 &&
      anchorMs >= calibration.receivedAtMs,
  };
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
  if (
    !clock.valid ||
    !Object.values(receipt).every(Number.isFinite) ||
    receipt.startSample !== clock.eligibleSamples ||
    receipt.endSample - receipt.startSample !== frameSamples ||
    receipt.beforeMs < due ||
    receipt.afterMs < receipt.beforeMs ||
    receipt.afterMs - due > 100 ||
    age < 0 ||
    age > 30000
  ) {
    return { clock: { ...clock, valid: false }, window: null };
  }
  const drift =
    Math.max(age, Math.abs(periodStart - clock.calibration.receivedAtMs)) *
    0.0001;
  const offsets = calibrationOffsets(clock.calibration, drift);
  return {
    clock: { ...clock, eligibleSamples: receipt.endSample },
    window: {
      beforeMs: periodStart + offsets.lower,
      afterMs: receipt.afterMs + offsets.upper,
    },
  };
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
  const drift = Math.max(age, 0) * 0.0001;
  const previous = calibrationOffsets(clock.calibration, drift);
  const next = calibrationOffsets(calibration, 0);
  const valid =
    clock.valid &&
    checked.valid &&
    age >= 0 &&
    age <= 30000 &&
    next.lower <= previous.upper &&
    next.upper >= previous.lower;
  return { ...clock, calibration, valid };
}

function calibrationOffsets(calibration: ClockCalibration, drift: number) {
  return {
    lower: calibration.serverNowMs - calibration.receivedAtMs - drift,
    upper:
      calibration.serverNowMs -
      calibration.sentAtMs +
      drift +
      (calibration.precisionMs ?? 0),
  };
}
