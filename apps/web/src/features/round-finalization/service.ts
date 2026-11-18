import { isAppError } from '@daisy/errors';
import type { AttendanceEvaluation } from '@daisy/db/attendance';
import type { WorkerTimers } from '../../lib/worker-timers';
import type { LoopPass } from '../../lib/idle-backoff';
import {
  LIVE_IDLE_MAX_MS,
  startWorkerLoop,
  type WorkWake,
} from '../../lib/worker-loop';
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

/** The work that can fail: one Round's stages, and the two sweeps. */
type MaintenanceWork = MaintenanceStage | 'discover' | 'rate';

/** One discovery page. `cycleComplete` ends a pass over every due Round. */
type DiscoveryPage = {
  readonly roundIds: readonly string[];
  /** Those still in their opening: only the clock can move them yet. */
  readonly openingIds?: readonly string[];
  readonly cycleComplete: boolean;
};
type MaintenancePorts = {
  readonly discover: () => Promise<DiscoveryPage>;
  readonly tick: (roundId: string) => Promise<unknown>;
  readonly evaluate: (roundId: string) => Promise<AttendanceEvaluation>;
  readonly finalize: (roundId: string) => Promise<unknown>;
  /** How many Rounds it rated, or more pages wait: zero is an idle sweep. */
  readonly rateUnrated: () => Promise<number>;
  readonly timers: WorkerTimers;
  /** A Round changed: discover now (ADR 0153). */
  readonly wake?: WorkWake | undefined;
  readonly failed: (error: unknown, stage: MaintenanceWork) => void;
  /** Monotonic milliseconds. */
  readonly now: () => number;
  /** Rounds an uncertain check-in writer holds, so none can go silently stuck. */
  readonly held?: (measure: {
    readonly rounds: number;
    readonly oldestMs: number;
  }) => void;
};

const terminalRace = (error: unknown) =>
  isAppError(error) && error.reason === 'attendance-terminal';

type RoundPhase = 'opening' | 'live';
type Evaluation = 'ended' | 'continue';
const evaluationOf = (found: AttendanceEvaluation): Evaluation =>
  found.kind === 'decided' &&
  (found.resolution.decision === 'forfeit' ||
    found.resolution.decision === 'abandoned')
    ? 'ended'
    : 'continue';

/** The one per-Round pacing map, with the held measure read from it. */
function createRoundPacing(input: MaintenancePorts) {
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
  pacing: ReturnType<typeof createRoundPacing>,
  roundId: string,
  phase: RoundPhase,
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
  if (phase === 'opening') return;
  if ((await pacing.evaluate(roundId)) === 'ended') {
    pacing.forget(roundId);
    return;
  }
  await stage('finalize', () => input.finalize(roundId));
}

/** Discovery and committed-rating recovery never wait for a competing Round's work. */
export function startRoundMaintenance(input: MaintenancePorts) {
  let stopped = false;
  const active = new Map<string, Promise<void>>();
  const waiting = new Map<string, RoundPhase>();
  const pacing = createRoundPacing(input);
  /** Every id this discovery cycle saw; a queued Round it missed is no longer due. */
  let seen = new Set<string>();
  const advance = () => {
    while (!stopped && active.size < MAX_ACTIVE_ROUNDS && waiting.size > 0) {
      const next = waiting.entries().next().value;
      if (next === undefined) return;
      const [id, phase] = next;
      waiting.delete(id);
      const work = Promise.resolve()
        .then(() => maintainRound(input, pacing, id, phase))
        .finally(() => {
          active.delete(id);
          advance();
        });
      active.set(id, work);
    }
  };
  /** A queued Round keeps its place, so repeated discovery can never reorder the queue. */
  const remember = ({ roundIds, openingIds, cycleComplete }: DiscoveryPage) => {
    const opening = new Set(openingIds);
    for (const id of roundIds) {
      seen.add(id);
      if (
        !active.has(id) &&
        (waiting.has(id) || waiting.size < MAX_WAITING_ROUNDS)
      )
        waiting.set(id, opening.has(id) ? 'opening' : 'live');
    }
    if (cycleComplete) {
      for (const id of waiting.keys()) if (!seen.has(id)) waiting.delete(id);
      for (const id of [...pacing.known()])
        if (!seen.has(id)) pacing.forget(id);
      seen = new Set();
    }
    advance();
  };
  /** Whether discovery found a due Round or has more pages to read. */
  const discover = async (): Promise<boolean> => {
    if (stopped) return false;
    try {
      const page = await input.discover();
      if (!stopped) remember(page);
      return page.roundIds.length > 0 || !page.cycleComplete;
    } catch (error) {
      input.failed(error, 'discover');
      return false;
    }
  };
  /** Whether the rating sweep rated a Round or has more pages to read. */
  const recoverRatings = async (): Promise<boolean> => {
    if (stopped) return false;
    try {
      return (await input.rateUnrated()) > 0;
    } catch (error) {
      input.failed(error, 'rate');
      return false;
    }
  };
  /**
   * One pulse: it worked while any Round is live, queued or due, so a live
   * Round's deadlines keep the busy pace; idle only when nothing is live.
   */
  const pulse = async (): Promise<LoopPass> => {
    const [due, rated] = await Promise.all([discover(), recoverRatings()]);
    return due || rated || active.size > 0 || waiting.size > 0
      ? 'worked'
      : 'idle';
  };
  const loop = startWorkerLoop({
    run: pulse,
    backoff: { busyMs: MAINTENANCE_PULSE_MS, idleMaxMs: LIVE_IDLE_MAX_MS },
    timers: input.timers,
    failed: (error) => input.failed(error, 'discover'),
    wake: input.wake,
  });
  let closing: Promise<void> | undefined;
  return {
    ready: loop.started,
    stop: () => {
      stopped = true;
      waiting.clear();
      closing ??= loop.stop().then(async () => {
        await Promise.all(active.values());
      });
      return closing;
    },
  };
}
