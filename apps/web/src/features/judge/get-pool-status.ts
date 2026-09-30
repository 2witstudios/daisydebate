import { samplePoolStatus } from '../../ui/mock/judge';
import type { PoolStatus } from './flow';

/**
 * The judge pool's one data seam: how long this judge has waited and how
 * long an offer stays open. Today it returns the sample; the matchmaking
 * service replaces this function and nothing else.
 */
export function getPoolStatus(): PoolStatus {
  return samplePoolStatus;
}
