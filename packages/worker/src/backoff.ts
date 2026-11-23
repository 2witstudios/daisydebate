/** What one pass of a background worker found. */
export type LoopPass = 'worked' | 'idle';
/** A pass's outcome as the schedule sees it: a thrown pass is `failed`. */
export type LoopOutcome = LoopPass | 'failed';

/**
 * How a polling worker paces itself: `busyMs` while passes find work, then
 * each empty or failed pass multiplies the wait by `factor`, up to
 * `idleMaxMs`. A wake signal or a pass that finds work starts again at
 * `busyMs`. An idle process polls once per `idleMaxMs`, not once per `busyMs`.
 */
export type IdleBackoff = {
  readonly busyMs: number;
  readonly idleMaxMs: number;
  /** Defaults to 2. */
  readonly factor?: number;
};

/** Refuses a schedule that cannot back off or would spin. */
export function validateIdleBackoff(backoff: IdleBackoff): IdleBackoff {
  const factor = backoff.factor ?? 2;
  if (
    !Number.isSafeInteger(backoff.busyMs) ||
    !Number.isSafeInteger(backoff.idleMaxMs) ||
    backoff.busyMs < 1 ||
    backoff.idleMaxMs < backoff.busyMs ||
    !Number.isFinite(factor) ||
    factor <= 1
  )
    throw new Error('Invalid worker idle back-off');
  return backoff;
}

/**
 * The wait before the next pass, from the wait before this one (`null` when
 * this pass followed a start or a wake) and what this pass found. Pure and
 * total over a validated schedule; whole milliseconds.
 */
export function nextWaitMs(
  backoff: IdleBackoff,
  previousMs: number | null,
  outcome: LoopOutcome,
): number {
  switch (outcome) {
    case 'worked':
      return backoff.busyMs;
    case 'idle':
    case 'failed':
      return previousMs === null
        ? backoff.busyMs
        : Math.min(
            backoff.idleMaxMs,
            Math.round(
              Math.max(backoff.busyMs, previousMs) * (backoff.factor ?? 2),
            ),
          );
  }
}

/** A pass that handled `count` items worked; none is idle. */
export const passOf = (count: number): LoopPass =>
  count > 0 ? 'worked' : 'idle';
