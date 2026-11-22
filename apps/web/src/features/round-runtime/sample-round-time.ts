import type { Scheduler } from '../realtime/connection-store';
import type { SyncVisibility } from '../resource-sync/driver';
import {
  MAX_SAMPLE_RTT_MS,
  RESAMPLE_EVERY_MS,
  retryDelayMs,
  SEED_RETRY_MS,
  type RoundTime,
} from './round-time';

type SampleState =
  | { readonly kind: 'stopped' }
  | {
      readonly kind: 'waiting' | 'reading' | 'followup';
      readonly debt: 'visible-only' | 'suspension';
      readonly failures: number;
    };

const abandoned = (signal: AbortSignal) =>
  new Promise<void>((resolve) =>
    signal.addEventListener('abort', () => resolve(), { once: true }),
  );

/**
 * One serial chain of clock reads per mounted Round. A read past the sample
 * envelope is abandoned, so a read that never settles cannot end sampling.
 * Wakes during a read coalesce into one followup; a hidden tab waits for its
 * visibility return. A suspension is the exception: it left the clock behind, and
 * a boundary still counts on that clock while hidden, so it owes a read until one
 * is accepted.
 */
export function sampleRoundTime(options: {
  readonly read: (signal: AbortSignal) => Promise<{ readonly kind: string }>;
  readonly roundTime: RoundTime;
  readonly scheduler: Scheduler;
  readonly visibility: SyncVisibility;
  readonly random: () => number;
}) {
  const { scheduler, visibility, roundTime } = options;
  const lifetime = new AbortController();
  let state: SampleState = {
    kind: 'waiting',
    debt: 'visible-only',
    failures: 0,
  };
  const currentState = (): SampleState => state;
  const mayRead = () =>
    state.kind !== 'stopped' &&
    (visibility.isVisible() || state.debt === 'suspension');
  let timer: unknown = null;
  const clear = () => {
    if (timer !== null) scheduler.clearTimeout(timer);
    timer = null;
  };
  const arm = (delayMs: number) => {
    timer = scheduler.setTimeout(() => {
      timer = null;
      if (mayRead()) void resample();
      else arm(RESAMPLE_EVERY_MS);
    }, delayMs);
  };
  const resample = async () => {
    if (state.kind === 'stopped') return;
    if (state.kind !== 'waiting') {
      state = { ...state, kind: 'followup' };
      return;
    }
    clear();
    state = { ...state, kind: 'reading' };
    const attempt = new AbortController();
    const release = () => attempt.abort();
    lifetime.signal.addEventListener('abort', release, { once: true });
    const deadline = scheduler.setTimeout(release, MAX_SAMPLE_RTT_MS);
    const answer = await Promise.race([
      // The measured read has already marked a failed read stale.
      options.read(attempt.signal).catch(() => undefined),
      abandoned(attempt.signal),
    ]);
    scheduler.clearTimeout(deadline);
    lifetime.signal.removeEventListener('abort', release);
    const finished = currentState();
    if (finished.kind === 'stopped') return;
    // A Round this caller can no longer read will not answer differently.
    if (answer?.kind === 'missing') {
      state = { ...finished, kind: 'waiting' };
      return;
    }
    const failures =
      roundTime.status().kind === 'current' ? 0 : finished.failures + 1;
    const followup = finished.kind === 'followup';
    state = {
      kind: 'waiting',
      debt: failures === 0 && !followup ? 'visible-only' : finished.debt,
      failures,
    };
    arm(
      followup
        ? SEED_RETRY_MS
        : failures === 0
          ? RESAMPLE_EVERY_MS
          : retryDelayMs(failures, options.random()),
    );
  };
  const unsubscribe = visibility.onVisible(() => void resample());
  void resample();
  return {
    wake: () => {
      if (mayRead()) void resample();
    },
    resumed: () => {
      if (state.kind === 'stopped') return;
      state = { ...state, debt: 'suspension' };
      void resample();
    },
    stop: () => {
      state = { kind: 'stopped' };
      lifetime.abort();
      clear();
      unsubscribe();
    },
  };
}
