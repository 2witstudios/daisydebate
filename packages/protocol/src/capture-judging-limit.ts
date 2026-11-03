/** PROVISIONAL. The share of speech that may go unheard and still be ruled on by AI. */
export const maxUnheardShare = 0.05;

/**
 * Whether this much of a Round's speech is within the limit. A freeze asks it of speech
 * unheard, for whether an AI judge may rule, and of speech the platform lost, for whether
 * the platform ended the Round. A measure that was never taken cannot be proven small.
 */
export const captureWithinLimit = (capture: {
  readonly gapMs: number | null;
  readonly expectedMs: number;
}): boolean =>
  capture.gapMs !== null &&
  capture.expectedMs > 0 &&
  capture.gapMs / capture.expectedMs <= maxUnheardShare;
