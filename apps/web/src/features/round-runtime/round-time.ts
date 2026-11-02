import { MAX_SERVER_INSTANT_MS } from './server-clock-header';

/** Browser monotonic intervals bracket an authorized server-clock sample. */
export const MAX_SAMPLE_RTT_MS = 2000;
export const RESAMPLE_EVERY_MS = 30_000;
export const SEED_RETRY_MS = 2000;
/** Fresh ordered samples that must agree before a server step back is believed. */
export const ROLLBACK_CONFIRMATIONS = 3;
/** Doubles from the first retry to the settled cadence, with half-range jitter. */
export const retryDelayMs = (failures: number, random: number) =>
  Math.min(SEED_RETRY_MS * 2 ** (failures - 1), RESAMPLE_EVERY_MS) *
  (0.5 + random);
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
  serverNowMs <= MAX_SERVER_INSTANT_MS;

/** Accept only overlapping authority bounds; refused evidence never changes the anchor. */
export const decideSample = (
  current: Calibration,
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
    generation <= current.generation ||
    receivedAtMs < current.monoAtReceiveMs
  )
    return { accepted: false, refusal: 'stale-generation' };
  if (current.real) {
    const projected =
      current.serverAtReceiveMs + receivedAtMs - current.monoAtReceiveMs;
    // The candidate range is [serverNowMs, serverNowMs + RTT]. It must
    // overlap the accepted projection's lower bound, not its old anchor.
    if (serverNowMs + rtt < projected - current.uncertaintyMs)
      return { accepted: false, refusal: 'server-rollback' };
  }
  return { accepted: true };
};
type RollbackRun = {
  readonly offsetMs: number;
  readonly uncertaintyMs: number;
  readonly count: number;
};
/** Extends a run of refused samples only while their offsets can agree. */
const nextRollbackRun = (
  run: RollbackRun | null,
  { serverNowMs, sentAtMs, receivedAtMs }: RoundTimeSample,
): RollbackRun => {
  const uncertaintyMs = (receivedAtMs - sentAtMs) / 2;
  const offsetMs = serverNowMs + uncertaintyMs - receivedAtMs;
  const agrees =
    run !== null &&
    Math.abs(offsetMs - run.offsetMs) <= uncertaintyMs + run.uncertaintyMs;
  return { offsetMs, uncertaintyMs, count: agrees ? run.count + 1 : 1 };
};
export type RoundTimeStatus = {
  readonly kind: 'seed' | 'current' | 'stale';
  readonly uncertaintyMs: number | null;
};
export type RoundTime = {
  nowMs(): number;
  sample(candidate: RoundTimeSample): SampleDecision;
  /** Samples a reply arriving now, on this clock's own monotonic epoch. */
  received(reply: Omit<RoundTimeSample, 'receivedAtMs'>): SampleDecision;
  unavailable(generation: number): void;
  /** Allocates a request's generation and sent instant before it is sent. */
  beginSample(): { readonly generation: number; readonly sentAtMs: number };
  status(): RoundTimeStatus;
  subscribe(listener: () => void): () => void;
};

/** One mounted Round owns this clock; neither Round revisions nor reads replace it. */
export function createRoundTime(options: {
  readonly monotonicNowMs: MonotonicClock;
  readonly hydrationSeedServerMs: number;
}): RoundTime {
  const monotonic = options.monotonicNowMs;
  let calibration: Calibration = {
    serverAtReceiveMs: options.hydrationSeedServerMs,
    monoAtReceiveMs: monotonic(),
    uncertaintyMs: Number.POSITIVE_INFINITY,
    generation: -1,
    real: false,
  };
  let allocated = 0;
  let failedGeneration = -1;
  let rollbackRun: RollbackRun | null = null;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const unavailable = (generation: number) => {
    if (
      !Number.isSafeInteger(generation) ||
      generation < 0 ||
      generation <= calibration.generation
    )
      return;
    failedGeneration = Math.max(failedGeneration, generation);
    notify();
  };
  const sample = (candidate: RoundTimeSample): SampleDecision => {
    const decision = decideSample(calibration, candidate);
    if (!decision.accepted && decision.refusal === 'server-rollback')
      rollbackRun = nextRollbackRun(rollbackRun, candidate);
    const confirmed = (rollbackRun?.count ?? 0) >= ROLLBACK_CONFIRMATIONS;
    if (!decision.accepted && !confirmed) {
      unavailable(candidate.generation);
      return decision;
    }
    rollbackRun = null;
    const rtt = candidate.receivedAtMs - candidate.sentAtMs;
    calibration = {
      serverAtReceiveMs: candidate.serverNowMs + rtt / 2,
      monoAtReceiveMs: candidate.receivedAtMs,
      uncertaintyMs: rtt / 2,
      generation: candidate.generation,
      real: true,
    };
    notify();
    return { accepted: true };
  };
  return {
    nowMs: () =>
      calibration.serverAtReceiveMs +
      Math.max(0, monotonic() - calibration.monoAtReceiveMs),
    sample,
    received: (reply) => sample({ ...reply, receivedAtMs: monotonic() }),
    unavailable,
    beginSample: () => ({ generation: ++allocated, sentAtMs: monotonic() }),
    status: () => ({
      kind: !calibration.real
        ? 'seed'
        : failedGeneration > calibration.generation ||
            monotonic() - calibration.monoAtReceiveMs >
              RESAMPLE_EVERY_MS + MAX_SAMPLE_RTT_MS
          ? 'stale'
          : 'current',
      uncertaintyMs: calibration.real ? calibration.uncertaintyMs : null,
    }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Brackets one authorized read on the browser's monotonic clock. */
export function createMeasuredRead<
  T extends {
    readonly kind: 'found' | 'missing' | 'unavailable';
    readonly serverNowMs?: number | null;
  },
>(options: {
  readonly read: (signal?: AbortSignal) => Promise<T>;
  readonly roundTime: RoundTime;
}): (signal?: AbortSignal) => Promise<T> {
  return async (signal) => {
    signal?.throwIfAborted();
    const { generation, sentAtMs } = options.roundTime.beginSample();
    const abandoned = () => options.roundTime.unavailable(generation);
    signal?.addEventListener('abort', abandoned, { once: true });
    try {
      const response = await options.read(signal);
      // An abandoned read's late reply is not evidence.
      if (signal?.aborted) return response;
      const serverNowMs =
        response.kind === 'found' ? response.serverNowMs : null;
      if (serverNowMs == null) abandoned();
      else options.roundTime.received({ serverNowMs, sentAtMs, generation });
      return response;
    } catch (error) {
      abandoned();
      throw error;
    } finally {
      signal?.removeEventListener('abort', abandoned);
    }
  };
}
