import type { Scheduler } from '../realtime/connection-store';
import type { SyncVisibility } from '../resource-sync/driver';
import type { RoundTime } from './round-time';
import { sampleRoundTime } from './sample-round-time';
import { watchClockSuspension } from './watch-clock-suspension';

/** The sampler and everything that wakes it, for one mounted Round. */
export function runRoundClock(options: {
  readonly read: (signal: AbortSignal) => Promise<{ readonly kind: string }>;
  readonly roundTime: RoundTime;
  readonly scheduler: Scheduler;
  readonly visibility: SyncVisibility;
  readonly random: () => number;
  readonly wallNowMs: () => number;
  readonly events: Pick<Window, 'addEventListener' | 'removeEventListener'>;
}) {
  const { events, wallNowMs, ...sampling } = options;
  const sampler = sampleRoundTime(sampling);
  const stopWatching = watchClockSuspension({
    scheduler: options.scheduler,
    wallNowMs,
    onResume: sampler.resumed,
  });
  events.addEventListener('pageshow', sampler.wake);
  events.addEventListener('online', sampler.wake);
  return {
    wake: sampler.wake,
    stop: () => {
      stopWatching();
      events.removeEventListener('pageshow', sampler.wake);
      events.removeEventListener('online', sampler.wake);
      sampler.stop();
    },
  };
}
