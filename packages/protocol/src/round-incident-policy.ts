/**
 * A platform incident's bounds (ADR 0110). Every value here is PROVISIONAL: the
 * failure drill has not run, and it sets them. Nothing here was measured.
 */
export const roundIncidentPolicy = {
  /** PROVISIONAL. How long the vendor stays unreachable before a Round pauses. */
  vendorUnreachableMs: 5_000,
  /** PROVISIONAL. With the platform back, how long a pause waits for absent seats. */
  seatGraceMs: 30_000,
  /** PROVISIONAL. Past this with the platform still down, the Round ends. */
  recoveryBoundMs: 90_000,
  /** PROVISIONAL. The automatic countdown shown to everyone before the clock runs. */
  resumeCountdownMs: 5_000,
  /** PROVISIONAL. The share of expected speech a Round may lose and still be judged by AI. */
  maxCaptureGapShare: 0.05,
} as const;

/**
 * Whether a freeze's capture is good enough for an AI judge: a small gap is judged and
 * stated. A gap that was never measured cannot be proven small.
 */
export const captureWithinLimit = (capture: {
  readonly gapMs: number | null;
  readonly expectedMs: number;
}): boolean =>
  capture.gapMs !== null &&
  capture.expectedMs > 0 &&
  capture.gapMs / capture.expectedMs <= roundIncidentPolicy.maxCaptureGapShare;
