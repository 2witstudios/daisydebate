import { driverEdges } from '../resource-sync/driver.test-support';
import { createMeasuredRead, createRoundTime } from './round-time';

export function timingFixture<
  T extends {
    readonly kind: 'found' | 'missing' | 'unavailable';
    readonly serverNowMs?: number | null;
  },
>(hydrationSeedServerMs?: number) {
  const edges = driverEdges<T>();
  const roundTime = createRoundTime({
    monotonicNowMs: edges.scheduler.now,
    ...(hydrationSeedServerMs === undefined ? {} : { hydrationSeedServerMs }),
  });
  let generation = 0;
  const read = createMeasuredRead({
    read: edges.read,
    roundTime,
    monotonicNowMs: edges.scheduler.now,
    nextGeneration: () => ++generation,
  });
  return {
    edges,
    roundTime,
    read,
    fail: () => roundTime.unavailable(++generation),
  };
}
