/** Browser monotonic intervals bracket an authorized server-clock sample. */
export const MAX_SAMPLE_RTT_MS = 2000;
export const RESAMPLE_EVERY_MS = 30_000;
export const SEED_RETRY_MS = 2000;
export type MonotonicClock = () => number;
export type RoundTimeSample = {
  readonly serverNowMs: number;
  readonly sentAtMs: number;
  readonly receivedAtMs: number;
  /** Allocated before sending the request, never at completion. */
  readonly generation: number;
};
export type SampleRefusal =
  | 'non-finite'
  | 'invalid-interval'
  | 'rtt-out-of-envelope'
  | 'stale-generation'
  | 'server-rollback';
export type SampleDecision =
  | { readonly accepted: true }
  | { readonly accepted: false; readonly refusal: SampleRefusal };
export type Calibration = {
  readonly serverAtReceiveMs: number;
  readonly monoAtReceiveMs: number;
  readonly uncertaintyMs: number;
  readonly generation: number;
  readonly real: boolean;
};

const validSampleFields = ({
  generation,
  sentAtMs,
  serverNowMs,
}: RoundTimeSample) =>
  Number.isSafeInteger(generation) &&
  generation >= 0 &&
  sentAtMs >= 0 &&
  serverNowMs >= 0 &&
  serverNowMs <= 8.64e15;

/** Accept only overlapping authority bounds; refused evidence never changes the anchor. */
export const decideSample = (
  current: Calibration | null,
  candidate: RoundTimeSample,
): SampleDecision => {
  const { serverNowMs, sentAtMs, receivedAtMs, generation } = candidate;
  if (![serverNowMs, sentAtMs, receivedAtMs, generation].every(Number.isFinite))
    return { accepted: false, refusal: 'non-finite' };
  if (!validSampleFields(candidate))
    return { accepted: false, refusal: 'invalid-interval' };
  const rtt = receivedAtMs - sentAtMs;
  if (rtt < 0 || rtt > MAX_SAMPLE_RTT_MS)
    return { accepted: false, refusal: 'rtt-out-of-envelope' };
  if (
    current !== null &&
    (generation <= current.generation || receivedAtMs < current.monoAtReceiveMs)
  )
    return { accepted: false, refusal: 'stale-generation' };
  if (current?.real) {
    const projected =
      current.serverAtReceiveMs + receivedAtMs - current.monoAtReceiveMs;
    // The candidate range is [serverNowMs, serverNowMs + RTT]. It must
    // overlap the accepted projection's lower bound, not its old anchor.
    if (serverNowMs + rtt < projected - current.uncertaintyMs)
      return { accepted: false, refusal: 'server-rollback' };
  }
  return { accepted: true };
};
export type RoundTimeStatus = {
  readonly kind: 'seed' | 'current' | 'stale';
  readonly uncertaintyMs: number | null;
};
export type RoundTime = {
  nowMs(): number;
  sample(candidate: RoundTimeSample): SampleDecision;
  unavailable(generation: number): void;
  calibration(): Calibration | null;
  status(): RoundTimeStatus;
  subscribe(listener: () => void): () => void;
};

/** One mounted Round owns this clock; neither Round revisions nor reads replace it. */
export function createRoundTime(options: {
  readonly monotonicNowMs: MonotonicClock;
  readonly hydrationSeedServerMs?: number;
}): RoundTime {
  const monotonic = options.monotonicNowMs;
  let calibration: Calibration | null =
    options.hydrationSeedServerMs === undefined
      ? null
      : {
          serverAtReceiveMs: options.hydrationSeedServerMs,
          monoAtReceiveMs: monotonic(),
          uncertaintyMs: Number.POSITIVE_INFINITY,
          generation: -1,
          real: false,
        };
  let failedGeneration = -1;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const unavailable = (generation: number) => {
    if (
      !Number.isSafeInteger(generation) ||
      generation < 0 ||
      generation <= (calibration?.generation ?? -1)
    )
      return;
    failedGeneration = Math.max(failedGeneration, generation);
    notify();
  };
  return {
    nowMs: () =>
      calibration === null
        ? 0
        : calibration.serverAtReceiveMs +
          Math.max(0, monotonic() - calibration.monoAtReceiveMs),
    sample: (candidate) => {
      const decision = decideSample(calibration, candidate);
      if (!decision.accepted) {
        unavailable(candidate.generation);
        return decision;
      }
      const rtt = candidate.receivedAtMs - candidate.sentAtMs;
      calibration = {
        serverAtReceiveMs: candidate.serverNowMs + rtt / 2,
        monoAtReceiveMs: candidate.receivedAtMs,
        uncertaintyMs: rtt / 2,
        generation: candidate.generation,
        real: true,
      };
      notify();
      return decision;
    },
    unavailable,
    calibration: () => calibration,
    status: () => ({
      kind: !calibration?.real
        ? 'seed'
        : failedGeneration > calibration.generation ||
            monotonic() - calibration.monoAtReceiveMs >
              RESAMPLE_EVERY_MS + MAX_SAMPLE_RTT_MS
          ? 'stale'
          : 'current',
      uncertaintyMs: calibration?.real ? calibration.uncertaintyMs : null,
    }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** This wrapper executes in the browser, outside any server action's clock epoch. */
export function createMeasuredRead<
  T extends {
    readonly kind: 'found' | 'missing' | 'unavailable';
    readonly serverNowMs?: number | null;
  },
>(options: {
  readonly read: () => Promise<T>;
  readonly roundTime: RoundTime;
  readonly monotonicNowMs: MonotonicClock;
  readonly nextGeneration: () => number;
}): (signal?: AbortSignal) => Promise<T> {
  return async (signal) => {
    signal?.throwIfAborted();
    const generation = options.nextGeneration();
    const sentAtMs = options.monotonicNowMs();
    try {
      const response = await options.read();
      // A server action cannot cancel work already executing on the server;
      // cancellation discards its client evidence and all subsequent effects.
      if (signal?.aborted) return response;
      const receivedAtMs = options.monotonicNowMs();
      if (response.kind === 'found' && response.serverNowMs != null)
        options.roundTime.sample({
          serverNowMs: response.serverNowMs,
          sentAtMs,
          receivedAtMs,
          generation,
        });
      else options.roundTime.unavailable(generation);
      return response;
    } catch (error) {
      if (!signal?.aborted) options.roundTime.unavailable(generation);
      throw error;
    }
  };
}
