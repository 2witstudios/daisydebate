import { isAppError } from '@daisy/errors';
import type { WorkerTimers } from '../../lib/worker-timers';

// The default shared pool has five writer/watchdog pairs; reserve headroom for discovery and public/control work.
const MAX_ACTIVE_ROUNDS = 2;
/** How often maintenance rediscovers due Rounds and recovers ratings. */
export const MAINTENANCE_PULSE_MS = 500;
/** Queued Rounds retained at once; discovery pauses at this bound, losing nothing. */
const MAX_WAITING_ROUNDS = 256;
/** How long an undecided window waits before its evidence is read again. */
const EVALUATION_RETRY_MS = 5_000;
/** The longest wait after repeated evaluation failures. */
const EVALUATION_RETRY_MAX_MS = 60_000;
/** How often the held-by-pending-writer measure is published. */
const HELD_REPORT_MS = 60_000;

/** One discovery page. `cycleComplete` ends a pass over every due Round. */
type DiscoveryPage = {
  readonly roundIds: readonly string[];
  readonly cycleComplete: boolean;
};
type MaintenancePorts = {
  readonly discover: () => Promise<DiscoveryPage>;
  readonly tick: (roundId: string) => Promise<unknown>;
  readonly evaluate: (
    roundId: string,
  ) => Promise<{ readonly decision: string } | null>;
  readonly finalize: (roundId: string) => Promise<unknown>;
  readonly rateUnrated: () => Promise<unknown>;
  readonly timers: WorkerTimers;
  /** `stage` names the work that failed: discover, tick, evaluate, finalize or rate. */
  readonly failed: (error: unknown, stage: string) => void;
  /** Monotonic milliseconds. */
  readonly now?: () => number;
  /** Rounds an uncertain check-in writer holds, so none can go silently stuck. */
  readonly held?: (measure: {
    readonly rounds: number;
    readonly oldestMs: number;
  }) => void;
};

const terminalRace = (error: unknown) =>
  isAppError(error) &&
  error.code === 'CONFLICT' &&
  error.message === 'attendance-terminal';

type Evaluation = 'ended' | 'continue';
/** Backoff and hold state per Round, so a known-blocked Round costs little and says why. */
function createEvaluationPacing(input: MaintenancePorts) {
  const now = input.now ?? (() => performance.now());
  const retryAt = new Map<string, number>();
  const failures = new Map<string, number>();
  const heldSince = new Map<string, number>();
  let lastHeldReport = Number.NEGATIVE_INFINITY;
  const reportHeld = () => {
    const at = now();
    if (heldSince.size === 0 || at - lastHeldReport < HELD_REPORT_MS) return;
    lastHeldReport = at;
    input.held?.({
      rounds: heldSince.size,
      oldestMs: Math.round(at - Math.min(...heldSince.values())),
    });
  };
  return {
    async evaluate(roundId: string): Promise<Evaluation> {
      if (now() < (retryAt.get(roundId) ?? Number.NEGATIVE_INFINITY))
        return 'continue';
      try {
        const resolution = await input.evaluate(roundId);
        failures.delete(roundId);
        if (resolution?.decision === 'held') {
          if (!heldSince.has(roundId)) heldSince.set(roundId, now());
          reportHeld();
        } else heldSince.delete(roundId);
        if (resolution === null || resolution.decision === 'held')
          retryAt.set(roundId, now() + EVALUATION_RETRY_MS);
        else retryAt.delete(roundId);
        return resolution?.decision === 'forfeit' ||
          resolution?.decision === 'abandoned'
          ? 'ended'
          : 'continue';
      } catch (error) {
        if (terminalRace(error)) return 'ended';
        const failed = (failures.get(roundId) ?? 0) + 1;
        failures.set(roundId, failed);
        retryAt.set(
          roundId,
          now() +
            Math.min(
              EVALUATION_RETRY_MS * 2 ** (failed - 1),
              EVALUATION_RETRY_MAX_MS,
            ),
        );
        input.failed(error, 'evaluate');
        return 'continue';
      }
    },
    known: () => retryAt.keys(),
    forget(roundId: string) {
      retryAt.delete(roundId);
      failures.delete(roundId);
      heldSince.delete(roundId);
    },
  };
}

/**
 * Each stage fails on its own: an evaluation failure must not starve a safe
 * transcript freeze. Competitive completion still refuses unsettled attendance.
 */
async function maintainRound(
  input: MaintenancePorts,
  pacing: ReturnType<typeof createEvaluationPacing>,
  roundId: string,
) {
  try {
    await input.tick(roundId);
  } catch (error) {
    if (terminalRace(error)) pacing.forget(roundId);
    else input.failed(error, 'tick');
    return;
  }
  if ((await pacing.evaluate(roundId)) === 'ended') {
    pacing.forget(roundId);
    return;
  }
  try {
    await input.finalize(roundId);
  } catch (error) {
    if (terminalRace(error)) pacing.forget(roundId);
    else input.failed(error, 'finalize');
  }
}

/** Discovery and committed-rating recovery never wait for a competing Round's work. */
export function startRoundMaintenance(input: MaintenancePorts) {
  let stopped = false,
    discovering = false,
    rating = false;
  let discoveryWork = Promise.resolve(),
    ratingWork = Promise.resolve();
  const active = new Map<string, Promise<void>>();
  const waiting = new Set<string>();
  const pacing = createEvaluationPacing(input);
  /** Every id this discovery cycle saw; a queued Round it missed is no longer due. */
  let seen = new Set<string>();
  const advance = () => {
    while (!stopped && active.size < MAX_ACTIVE_ROUNDS && waiting.size > 0) {
      const id = waiting.values().next().value;
      if (id === undefined) return;
      waiting.delete(id);
      const work = Promise.resolve()
        .then(() => maintainRound(input, pacing, id))
        .finally(() => {
          active.delete(id);
          advance();
        });
      active.set(id, work);
    }
  };
  /** A queued Round keeps its place, so repeated discovery can never reorder the queue. */
  const remember = ({ roundIds, cycleComplete }: DiscoveryPage) => {
    for (const id of roundIds) {
      seen.add(id);
      if (!active.has(id) && waiting.size < MAX_WAITING_ROUNDS) waiting.add(id);
    }
    if (cycleComplete) {
      for (const id of waiting) if (!seen.has(id)) waiting.delete(id);
      for (const id of [...pacing.known()])
        if (!seen.has(id)) pacing.forget(id);
      seen = new Set();
    }
    advance();
  };
  const discover = async () => {
    if (stopped || discovering) return;
    discovering = true;
    try {
      const page = await input.discover();
      if (!stopped) remember(page);
    } catch (error) {
      input.failed(error, 'discover');
    } finally {
      discovering = false;
    }
  };
  const recoverRatings = async () => {
    if (stopped || rating) return;
    rating = true;
    try {
      await input.rateUnrated();
    } catch (error) {
      input.failed(error, 'rate');
    } finally {
      rating = false;
    }
  };
  const pulse = () => {
    if (!discovering) discoveryWork = discover();
    if (!rating) ratingWork = recoverRatings();
    return Promise.all([discoveryWork, ratingWork]).then(() => undefined);
  };
  const timer = input.timers.setInterval(pulse, MAINTENANCE_PULSE_MS);
  const ready = pulse();
  let closing: Promise<void> | undefined;
  return {
    ready,
    stop: () => {
      stopped = true;
      waiting.clear();
      input.timers.clearInterval(timer);
      closing ??= Promise.all([discoveryWork, ratingWork]).then(async () => {
        await Promise.all(active.values());
      });
      return closing;
    },
  };
}
