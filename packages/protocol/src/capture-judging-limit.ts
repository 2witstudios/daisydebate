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

/** What a freeze measured of its capture. */
export type FrozenCapture = { readonly expectedMs: number } & (
  | {
      readonly kind: 'measured';
      /** All speech nobody heard, a silent seat's too: whether an AI judge may rule. */
      readonly unheardMs: number;
      /** The speech the platform lost: whether the platform ended the Round. */
      readonly platformLostMs: number;
    }
  /** A stream outside the platform's losses has no measure. */
  | { readonly kind: 'unheard-unmeasured'; readonly platformLostMs: number }
  /** A stream the platform lost has no measure, so its loss cannot be proven small. */
  | { readonly kind: 'platform-unmeasured' }
);

/** A freeze row's columns, which hold exactly these three kinds. */
export type FrozenCaptureColumns = {
  readonly expectedSpeechMs: number;
  readonly captureGapMs: number | null;
  readonly unheardMs: number | null;
};

export const frozenCaptureColumns = (
  capture: FrozenCapture,
): FrozenCaptureColumns => ({
  expectedSpeechMs: capture.expectedMs,
  captureGapMs:
    capture.kind === 'platform-unmeasured' ? null : capture.platformLostMs,
  unheardMs: capture.kind === 'measured' ? capture.unheardMs : null,
});

export const frozenCaptureOf = (row: FrozenCaptureColumns): FrozenCapture => {
  const expectedMs = row.expectedSpeechMs;
  if (row.captureGapMs === null)
    return { kind: 'platform-unmeasured', expectedMs };
  return row.unheardMs === null
    ? {
        kind: 'unheard-unmeasured',
        platformLostMs: row.captureGapMs,
        expectedMs,
      }
    : {
        kind: 'measured',
        unheardMs: row.unheardMs,
        platformLostMs: row.captureGapMs,
        expectedMs,
      };
};

/**
 * Whether the platform lost more than can be judged. Silence past the limit is not this,
 * and neither is a platform loss under the limit that silence tips over (ADR 0110).
 */
export const platformLostTooMuch = (capture: FrozenCapture): boolean =>
  capture.kind === 'platform-unmeasured' ||
  (capture.platformLostMs > 0 &&
    !captureWithinLimit({
      gapMs: capture.platformLostMs,
      expectedMs: capture.expectedMs,
    }));
