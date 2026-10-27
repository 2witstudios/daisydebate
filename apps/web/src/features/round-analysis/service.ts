import { isAppError } from '@daisy/errors';
import type { RoundAnalysisSeat } from '@daisy/db/rounds';
import type { WorkerTimers } from '../../server/worker-timers';

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
  /** `stage` names the work that failed: analyse or scan. */
  readonly failed: (error: unknown, stage: string) => void;
}) {
  const running = new Map<string, Promise<void>>();
  const abort = new AbortController();
  let scanning: Promise<void> | null = null;
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
  const scan = (): Promise<void> => {
    if (abort.signal.aborted || scanning) return scanning ?? Promise.resolve();
    // Cleared in a later turn: a scan that ends before its first await
    // would otherwise clear the marker before it is set.
    scanning = (async () => {
      try {
        if (running.size >= input.limits.parallel) return;
        for (const seat of await input.scan(input.limits.scanBatch)) {
          if (abort.signal.aborted || running.size >= input.limits.parallel)
            break;
          if (!running.has(seat.roundParticipantId)) start(seat);
        }
      } catch (error) {
        input.failed(error, 'scan');
      }
    })().finally(() => {
      scanning = null;
    });
    return scanning;
  };
  const discovery = input.timers.setInterval(scan, input.limits.scanMs);
  const started = scan();
  return {
    started,
    async stop() {
      abort.abort();
      input.timers.clearInterval(discovery);
      await Promise.allSettled([scanning, ...running.values()]);
    },
  };
}
