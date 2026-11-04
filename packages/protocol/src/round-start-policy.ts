/**
 * How a speech's start waits for capture, held to the shortest that measures reliably
 * (ADR 0110). The next speaker's microphone opens this long before the clock, with the
 * seat told first, because the other side can hear it. 1.5 s measured reliably on staging;
 * 1.2 s is the candidate that staging's rerun still has to prove.
 */
export const roundStartPolicy = {
  microphoneLeadMs: 1_200,
  /** Past the due instant, how long a start waits for capture. A late start is the clock. */
  captureHoldBoundMs: 1_500,
} as const;

/** The instant a start gate holds its segment to, for every reader of the clock. */
export const startGateInstant = (
  gate:
    | { readonly phase: 'awaiting'; readonly until: string }
    | { readonly phase: 'ready'; readonly at: string },
): string => (gate.phase === 'awaiting' ? gate.until : gate.at);
