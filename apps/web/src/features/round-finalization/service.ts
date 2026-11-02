import { isAppError } from '@daisy/errors';
import type { AttendanceEvaluation } from '@daisy/db/attendance';
import type { WorkerTimers } from '../../lib/worker-timers';
import {
  nextPacing,
  noPacing,
  stageDue,
  type MaintenanceStage,
  type PacingEvent,
  type RoundPacing,
} from './round-pacing';

// The default shared pool has five writer/watchdog pairs; reserve headroom for discovery and public/control work.
const MAX_ACTIVE_ROUNDS = 2;
/** How often maintenance rediscovers due Rounds and recovers ratings. */
export const MAINTENANCE_PULSE_MS = 500;
/** Queued Rounds retained at once; ids past this wait for a later discovery cycle. */
const MAX_WAITING_ROUNDS = 256;
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
  readonly evaluate: (roundId: string) => Promise<AttendanceEvaluation>;
  readonly finalize: (roundId: string) => Promise<unknown>;
  readonly rateUnrated: () => Promise<unknown>;
  readonly timers: WorkerTimers;
  /** `stage` names the work that failed: discover, tick, evaluate, finalize or rate. */
  readonly failed: (error: unknown, stage: string) => void;
  /** Monotonic milliseconds. */
  readonly now: () => number;
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
const evaluationOf = (found: AttendanceEvaluation): Evaluation =>
  found.kind === 'decided' &&
  (found.resolution.decision === 'forfeit' ||
    found.resolution.decision === 'abandoned')
    ? 'ended'
    : 'continue';

/** The one per-Round pacing map, with the held measure read from it. */
function createEvaluationPacing(input: MaintenancePorts) {
  const { now } = input;
  const rounds = new Map<string, RoundPacing>();
  let lastHeldReport = Number.NEGATIVE_INFINITY;
  const reportHeld = () => {
    const at = now();
    const held = [...rounds.values()].flatMap(({ heldSinceMs }) =>
      heldSinceMs === null ? [] : [heldSinceMs],
    );
    if (held.length === 0 || at - lastHeldReport < HELD_REPORT_MS) return;
    lastHeldReport = at;
    input.held?.({
      rounds: held.length,
      oldestMs: Math.round(at - Math.min(...held)),
    });
  };
  const apply = (roundId: string, event: PacingEvent) => {
    const next = nextPacing(rounds.get(roundId) ?? noPacing, event, now());
    if (next.heldSinceMs === null && Object.keys(next.stages).length === 0)
      rounds.delete(roundId);
    else rounds.set(roundId, next);
  };
  const due = (roundId: string, stage: MaintenanceStage) =>
    stageDue(rounds.get(roundId) ?? noPacing, stage, now());
  return {
    apply,
    due,
    async evaluate(roundId: string): Promise<Evaluation> {
      if (!due(roundId, 'evaluate')) return 'continue';
      try {
        const found = await input.evaluate(roundId);
        apply(roundId, { on: 'evaluated', found: found.kind });
        if (found.kind === 'held') reportHeld();
        return evaluationOf(found);
      } catch (error) {
        if (terminalRace(error)) return 'ended';
        apply(roundId, { on: 'stage_failed', stage: 'evaluate' });
        input.failed(error, 'evaluate');
        return 'continue';
      }
    },
    /** Every Round holding pacing state, so a finished one can be forgotten. */
    known: () => new Set(rounds.keys()),
    forget: (roundId: string) => rounds.delete(roundId),
  };
}

/**
 * Each stage fails on its own and backs off on its own: a failing tick must not
 * stop a Round reaching its cutoff, and an evaluation failure must not starve a
 * safe transcript freeze. Competitive completion still refuses unsettled
 * attendance.
 */
async function maintainRound(
  input: MaintenancePorts,
  pacing: ReturnType<typeof createEvaluationPacing>,
  roundId: string,
) {
  const stage = async (
    name: 'tick' | 'finalize',
    work: () => Promise<unknown>,
  ) => {
    if (!pacing.due(roundId, name)) return true;
    try {
      await work();
      pacing.apply(roundId, { on: 'stage_ok', stage: name });
      return true;
    } catch (error) {
      if (terminalRace(error)) {
        pacing.forget(roundId);
        return false;
      }
      pacing.apply(roundId, { on: 'stage_failed', stage: name });
      input.failed(error, name);
      return true;
    }
  };
  if (!(await stage('tick', () => input.tick(roundId)))) return;
  if ((await pacing.evaluate(roundId)) === 'ended') {
    pacing.forget(roundId);
    return;
  }
  await stage('finalize', () => input.finalize(roundId));
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
