'use client';
import { useEffect, useRef, useState } from 'react';

export type MonotonicClock = () => number;

/** Default monotonic source: the browser's high-resolution clock. */
export const defaultMonotonicClock: MonotonicClock = () => performance.now();

/** Maximum acceptable round-trip for a server time sample. */
/** High-latency samples are still useful as a first calibration up to this bound. */
export const MAX_SAMPLE_RTT_MS = 2000;

export type RoundTimeSample = {
  /** Milliseconds server time generated during the measured request interval. */
  readonly serverNowMs: number;
  readonly sentAtMs: number;
  readonly receivedAtMs: number;
  /** Mandatory monotonic request generation for ordering. */
  readonly generation: number;
  /** Estimated uncertainty (<= RTT/2) for the accepted sample. */
  readonly uncertaintyMs?: number;
};

/**
 * One round-scoped calibrated clock. Owns the current server-time sample and
 * rejects stale or high-latency samples. Advances only on injected monotonic
 * elapsed time, so browser wall-clock skew, adjustment, tab suspension and
 * rejoin cannot desync it (suspension is corrected by a fresh sample).
 */
export function createRoundTime(options: {
  readonly initial: RoundTimeSample;
  readonly monotonicNowMs?: MonotonicClock;
}) {
  const monotonic = options.monotonicNowMs ?? defaultMonotonicClock;
  let current: RoundTimeSample = options.initial;
  let lastReceivedAtMs = options.initial.receivedAtMs;
  let lastGeneration =
    options.initial.generation ?? Number.NEGATIVE_INFINITY;

  function sample(candidate: RoundTimeSample): boolean {
    const rtt = candidate.receivedAtMs - candidate.sentAtMs;
    if (!Number.isFinite(rtt) || rtt < 0 || rtt > MAX_SAMPLE_RTT_MS)
      return false;
    if (candidate.generation <= lastGeneration) return false;
    // Estimate server time at receive = serverSample + RTT/2, uncertainty <= RTT/2.
    const estimatedServerNowAtReceive = candidate.serverNowMs + rtt / 2;
    const uncertaintyMs = rtt / 2;
    // Rollback prevention.
    if (estimatedServerNowAtReceive + MAX_SAMPLE_RTT_MS < (current.uncertaintyMs !== undefined ? current.serverNowMs : current.serverNowMs))
      return false;
    const accepted: RoundTimeSample = {
      ...candidate,
      serverNowMs: estimatedServerNowAtReceive,
      uncertaintyMs,
    };
    current = accepted;
    lastReceivedAtMs = Math.max(lastReceivedAtMs, candidate.receivedAtMs);
    lastGeneration = candidate.generation;
    return true;
  }

  function nowMs(): number {
    return current.serverNowMs + (monotonic() - current.receivedAtMs);
  }

  return {
    nowMs,
    sample,
    currentSample: () => current,
  };
}

/** Pure calibrated now given a sample and a monotonic instant. */
export function calibratedNowMs(sample: RoundTimeSample, monotonicNowMs: number): number {
  return sample.serverNowMs + (monotonicNowMs - sample.receivedAtMs);
}

/**
 * The server's clock at one instant, read once a second: the clock edge of a
 * live view. Anchored to the server render instant; advances on a monotonic
 * clock. Re-ticks on visibility change; a fresh sample (via createRoundTime)
 * corrects suspension drift.
 */
export function useSecond(
  renderedAtMs: number,
  roundTime?: ReturnType<typeof createRoundTime>,
): number {
  const internalRef = useRef<ReturnType<typeof createRoundTime> | null>(null);
  if (roundTime === undefined && internalRef.current === null) {
    const anchor = defaultMonotonicClock();
    internalRef.current = createRoundTime({
      initial: {
        serverNowMs: renderedAtMs,
        sentAtMs: anchor,
        receivedAtMs: anchor,
        generation: 0,
        uncertaintyMs: MAX_SAMPLE_RTT_MS,
      },
      monotonicNowMs: defaultMonotonicClock,
    });
  }
  const clock = roundTime ?? (internalRef.current as ReturnType<typeof createRoundTime>);
  const [now, setNow] = useState(clock.nowMs());
  useEffect(() => {
    const tick = () => setNow(clock.nowMs());
    tick();
    const timer = window.setInterval(tick, 1000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [clock]);
  return now;
}