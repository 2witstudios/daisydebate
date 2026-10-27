/**
 * The speech timer as pure state. The client advances it with the time that
 * passed since its last tick, so tests inject durations and nothing here
 * reads a clock.
 */
export type ClockState = {
  readonly remainingMs: number;
  readonly paused: boolean;
};

export const startClock = (totalSeconds: number): ClockState => ({
  remainingMs: Math.max(0, totalSeconds) * 1000,
  paused: false,
});

/** Advances a running clock; a paused or finished clock does not move. */
export const tick = (state: ClockState, elapsedMs: number): ClockState =>
  state.paused || elapsedMs <= 0
    ? state
    : { ...state, remainingMs: Math.max(0, state.remainingMs - elapsedMs) };

/**
 * Practice only (ADR 0033 says ranked clocks never pause; the mock adds this
 * pause for practice, which the design asked for).
 */
export const pause = (state: ClockState): ClockState => ({
  ...state,
  paused: true,
});

export const resume = (state: ClockState): ClockState => ({
  ...state,
  paused: false,
});

export const isTimeUp = (state: ClockState): boolean => state.remainingMs <= 0;

/** Percent of the speech already used, 0 to 100. */
export const elapsedPercent = (
  totalSeconds: number,
  state: ClockState,
): number =>
  totalSeconds <= 0
    ? 100
    : Math.round((1 - state.remainingMs / (totalSeconds * 1000)) * 100);
