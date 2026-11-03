import { spectatorClockAt } from './spectator-clock';

/** Rounds ended this recently can still have a fact to log: the longest policy hold. */
const ENDED_WITHIN_HOURS = 48;
const BATCH = 256;

/**
 * One pass of the append-only release log (BCAST-5), so a fact's release time is
 * no later than one pass after it left. The worker's role cannot write here, by
 * design; only this sweep does.
 */
export const createFactLogSweep =
  (deps: {
    readonly store: {
      readonly sweepSpectatorFactLog: (input: {
        readonly clock: ReturnType<typeof spectatorClockAt>;
        readonly endedWithinHours: number;
        readonly limit: number;
      }) => Promise<number>;
    };
    readonly now: () => string;
  }) =>
  () =>
    deps.store.sweepSpectatorFactLog({
      clock: spectatorClockAt(deps.now()),
      endedWithinHours: ENDED_WITHIN_HOURS,
      limit: BATCH,
    });
