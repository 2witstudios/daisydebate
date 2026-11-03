import { spectatorClockAt } from './spectator-clock';

/** Rounds one pass takes. A recorded Round leaves the query, so the next pass reaches the rest. */
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
        readonly limit: number;
      }) => Promise<number>;
    };
    readonly now: () => string;
  }) =>
  () =>
    deps.store.sweepSpectatorFactLog({
      clock: spectatorClockAt(deps.now()),
      limit: BATCH,
    });
