/**
 * How a speech's start waits for capture, held to the shortest that measures reliably
 * (ADR 0110). The next speaker's microphone opens this long before the clock, with the
 * seat told first, because the other side can hear it. MEASURED on staging: see the ADR.
 */
export const roundStartPolicy = {
  microphoneLeadMs: 1_500,
  /** Past the due instant, how long a start waits for capture. A late start is the clock. */
  captureHoldBoundMs: 1_500,
} as const;
