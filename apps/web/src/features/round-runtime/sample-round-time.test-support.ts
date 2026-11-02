import { driverEdges } from '../resource-sync/driver.test-support';
import { createMeasuredRead, createRoundTime } from './round-time';

export function timingFixture<
  T extends {
    readonly kind: 'found' | 'missing' | 'unavailable';
    readonly serverNowMs?: number | null;
  },
>(hydrationSeedServerMs = 0) {
  const edges = driverEdges<T>();
  const roundTime = createRoundTime({
    monotonicNowMs: edges.scheduler.now,
    hydrationSeedServerMs,
  });
  const read = createMeasuredRead({ read: edges.read, roundTime });
  return { edges, roundTime, read };
}
