import type { Scheduler } from '../realtime/connection-store';
import type { SyncVisibility } from '../resource-sync/driver';
import { RESAMPLE_EVERY_MS, SEED_RETRY_MS, type RoundTime } from './round-time';

/** One serial retry chain per mounted Round; visibility requests coalesce while pending. */
export function sampleRoundTime(options: {
  readonly read: (signal: AbortSignal) => Promise<unknown>;
  readonly roundTime: RoundTime;
  readonly scheduler: Scheduler;
  readonly visibility: SyncVisibility;
}): () => void {
  const lifetime = new AbortController();
  let stopped = false;
  let fastRetry = false;
  let pending = false;
  let timer: unknown = null;
  const clear = () => {
    if (timer !== null) options.scheduler.clearTimeout(timer);
    timer = null;
    fastRetry = false;
  };
  const resample = async () => {
    if (stopped || pending) return;
    clear();
    pending = true;
    try {
      await options.read(lifetime.signal);
    } catch {
      // The measured read has already marked the clock stale. Keep retrying.
    } finally {
      pending = false;
      if (!stopped) {
        fastRetry = options.roundTime.status().kind !== 'current';
        timer = options.scheduler.setTimeout(
          () => void resample(),
          fastRetry ? SEED_RETRY_MS : RESAMPLE_EVERY_MS,
        );
      }
    }
  };
  const stopClock = options.roundTime.subscribe(() => {
    // A concurrent resource read can reject time while its Round value is
    // current. Bring the sampling retry forward without overlapping reads.
    if (
      stopped ||
      pending ||
      fastRetry ||
      options.roundTime.status().kind === 'current'
    )
      return;
    clear();
    fastRetry = true;
    timer = options.scheduler.setTimeout(() => void resample(), SEED_RETRY_MS);
  });
  const unsubscribe = options.visibility.onVisible(() => void resample());
  void resample();
  return () => {
    stopped = true;
    lifetime.abort();
    clear();
    unsubscribe();
    stopClock();
  };
}
