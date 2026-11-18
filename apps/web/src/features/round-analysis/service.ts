import { isAppError } from '@daisy/errors';
import type { RoundAnalysisSeat } from '@daisy/db/rounds';
import type { WorkerTimers } from '../../lib/worker-timers';
import type { LoopPass } from '../../lib/idle-backoff';
import {
  HOUSEKEEPING_IDLE_MAX_MS,
  startWorkerLoop,
  type WorkWake,
} from '../../lib/worker-loop';

/**
 * The round analysis worker: each scan lists debater seats that need an
 * analysis and starts one analysis call per seat, up to `parallel` at once.
 * A call's lease covers it whole, so nothing renews; a lapsed lease is
 * simply claimed again on a later scan while the seat has calls left.
 */
export function startRoundAnalysisService(input: {
  readonly scan: (limit: number) => Promise<readonly RoundAnalysisSeat[]>;
  readonly analyse: (
    seat: RoundAnalysisSeat,
    signal: AbortSignal,
  ) => Promise<unknown>;
  readonly limits: {
    readonly parallel: number;
    readonly scanBatch: number;
    readonly scanMs: number;
  };
  readonly timers: WorkerTimers;
  /** An analysis was requested; scan now (ADR 0153). */
  readonly wake?: WorkWake | undefined;
  /** `stage` names the work that failed: analyse or scan. */
  readonly failed: (error: unknown, stage: string) => void;
}) {
  const running = new Map<string, Promise<void>>();
  const abort = new AbortController();
  const start = (seat: RoundAnalysisSeat) => {
    const key = seat.roundParticipantId;
    const work = input
      .analyse(seat, abort.signal)
      .then(
        () => undefined,
        (error: unknown) => {
          // A full provider or a stop is not a fault: the seat waits for a later scan.
          if (isAppError(error) && error.code === 'CONFLICT') return;
          input.failed(error, 'analyse');
        },
      )
      .finally(() => running.delete(key));
    running.set(key, work);
  };
  /** One discovery pass; it worked while any analysis runs or was found. */
  const scan = async (): Promise<LoopPass> => {
    if (abort.signal.aborted) return 'idle';
    if (running.size >= input.limits.parallel) return 'worked';
    let found = 0;
    try {
      const seats = await input.scan(input.limits.scanBatch);
      found = seats.length;
      for (const seat of seats) {
        if (abort.signal.aborted || running.size >= input.limits.parallel)
          break;
        if (!running.has(seat.roundParticipantId)) start(seat);
      }
    } catch (error) {
      input.failed(error, 'scan');
    }
    return running.size > 0 || found > 0 ? 'worked' : 'idle';
  };
  const discovery = startWorkerLoop({
    run: scan,
    backoff: {
      busyMs: input.limits.scanMs,
      idleMaxMs: Math.max(input.limits.scanMs, HOUSEKEEPING_IDLE_MAX_MS),
    },
    timers: input.timers,
    failed: (error) => input.failed(error, 'scan'),
    wake: input.wake,
  });
  return {
    started: discovery.started,
    async stop() {
      abort.abort();
      await Promise.allSettled([discovery.stop(), ...running.values()]);
    },
  };
}
