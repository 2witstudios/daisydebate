'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  createMeasuredRead,
  createRoundTime,
} from '../../features/round-runtime/round-time';
import { sampleRoundTime } from '../../features/round-runtime/sample-round-time';
import { browserSyncEdges } from '../../features/resource-sync/browser';
import { systemScheduler } from '../../features/realtime/browser-adapters';
import type { RoundRead } from '../../features/round-runtime/read-round';

/** The single clock lifetime shared by debater, judge and spectator owners. */
export function useRoundTime(options: {
  readonly renderedAtMs: number;
  readonly read: () => Promise<RoundRead>;
}) {
  const [roundTime] = useState(() =>
    createRoundTime({
      monotonicNowMs: systemScheduler.now,
      hydrationSeedServerMs: options.renderedAtMs,
    }),
  );
  const nextGeneration = useMemo(() => {
    let allocated = 0;
    return () => ++allocated;
  }, []);
  const sampledRead = useMemo(
    () =>
      createMeasuredRead({
        read: options.read,
        roundTime,
        monotonicNowMs: systemScheduler.now,
        nextGeneration,
      }),
    [options.read, roundTime, nextGeneration],
  );
  useEffect(
    () =>
      sampleRoundTime({
        read: sampledRead,
        roundTime,
        scheduler: systemScheduler,
        visibility: browserSyncEdges(null).visibility,
      }),
    [sampledRead, roundTime],
  );
  return { roundTime, sampledRead };
}
