import type { Scheduler } from '../realtime/connection-store';
import type { SyncVisibility } from '../resource-sync/driver';
import {
  MAX_SAMPLE_RTT_MS,
  RESAMPLE_EVERY_MS,
  retryDelayMs,
  SEED_RETRY_MS,
  type RoundTime,
} from './round-time';

const abandoned = (signal: AbortSignal) =>
  new Promise<void>((resolve) =>
    signal.addEventListener('abort', () => resolve(), { once: true }),
  );

/**
 * One serial chain of clock reads per mounted Round. A read past the sample
 * envelope is abandoned, so a read that never settles cannot end sampling.
 * Wakes during a read coalesce into one followup; a hidden tab waits for its
 * visibility return.
 */
export function sampleRoundTime(options: {
  readonly read: (signal: AbortSignal) => Promise<unknown>;
  readonly roundTime: RoundTime;
  readonly scheduler: Scheduler;
  readonly visibility: SyncVisibility;
  readonly random: () => number;
}) {
  const { scheduler, visibility, roundTime } = options;
  const lifetime = new AbortController();
  let pending = false;
  let followup = false;
  let failures = 0;
  let timer: unknown = null;
  const clear = () => {
    if (timer !== null) scheduler.clearTimeout(timer);
    timer = null;
  };
  const arm = (delayMs: number) => {
    timer = scheduler.setTimeout(() => {
      timer = null;
      if (visibility.isVisible()) void resample();
      else arm(RESAMPLE_EVERY_MS);
    }, delayMs);
  };
  const nextDelayMs = () => {
    failures = roundTime.status().kind === 'current' ? 0 : failures + 1;
    if (followup) return SEED_RETRY_MS;
    return failures === 0
      ? RESAMPLE_EVERY_MS
      : retryDelayMs(failures, options.random());
  };
  const resample = async () => {
    if (lifetime.signal.aborted) return;
    if (pending) {
      followup = true;
      return;
    }
    clear();
    followup = false;
    pending = true;
    const attempt = new AbortController();
    const release = () => attempt.abort();
    lifetime.signal.addEventListener('abort', release, { once: true });
    const deadline = scheduler.setTimeout(release, MAX_SAMPLE_RTT_MS);
    await Promise.race([
      // The measured read has already marked a failed read stale.
      options.read(attempt.signal).catch(() => undefined),
      abandoned(attempt.signal),
    ]);
    scheduler.clearTimeout(deadline);
    lifetime.signal.removeEventListener('abort', release);
    pending = false;
    if (!lifetime.signal.aborted) arm(nextDelayMs());
  };
  const unsubscribe = visibility.onVisible(() => void resample());
  void resample();
  return {
    wake: () => void resample(),
    stop: () => {
      lifetime.abort();
      clear();
      unsubscribe();
    },
  };
}
