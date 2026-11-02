'use client';
import { systemClock } from '@daisy/clock';
import { useCallback, useEffect, useRef, useState } from 'react';
import { readRoundClock } from '../../features/round-runtime/read-round-clock';
import {
  createMeasuredRead,
  createRoundTime,
} from '../../features/round-runtime/round-time';
import { sampleRoundTime } from '../../features/round-runtime/sample-round-time';
import { watchClockSuspension } from '../../features/round-runtime/watch-clock-suspension';
import { browserSyncEdges } from '../../features/resource-sync/browser';
import {
  secureRandom,
  systemScheduler,
} from '../../features/realtime/browser-adapters';

const noWake = () => {};

/** The single clock lifetime shared by debater, judge and spectator owners. */
export function useRoundTime(options: {
  readonly renderedAtMs: number;
  /** The authorized read this role already holds, reached from the browser. */
  readonly clockUrl: string;
}) {
  const { clockUrl } = options;
  const [roundTime] = useState(() =>
    createRoundTime({
      monotonicNowMs: systemScheduler.now,
      hydrationSeedServerMs: options.renderedAtMs,
    }),
  );
  const wake = useRef(noWake);
  const wakeClock = useCallback(() => wake.current(), []);
  useEffect(() => {
    const sampler = sampleRoundTime({
      read: createMeasuredRead({
        read: (signal) =>
          readRoundClock((url, init) => fetch(url, init), clockUrl, signal),
        roundTime,
      }),
      roundTime,
      scheduler: systemScheduler,
      visibility: browserSyncEdges(null).visibility,
      random: secureRandom,
    });
    wake.current = sampler.wake;
    const stopWatching = watchClockSuspension({
      scheduler: systemScheduler,
      wallNowMs: () => Date.parse(systemClock.now()),
      onResume: sampler.wake,
    });
    window.addEventListener('pageshow', sampler.wake);
    window.addEventListener('online', sampler.wake);
    return () => {
      wake.current = noWake;
      stopWatching();
      window.removeEventListener('pageshow', sampler.wake);
      window.removeEventListener('online', sampler.wake);
      sampler.stop();
    };
  }, [clockUrl, roundTime]);
  return { roundTime, wakeClock };
}
