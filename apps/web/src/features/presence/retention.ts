import type { RetentionTarget } from '../../server/retention-target';

/**
 * ADR 0033: the online set's lapsed members, which reads filter but
 * never delete. Redis is expendable, so a failure here costs only stale
 * members until the next run, yet that run still did not complete. 1000
 * is the adapter's per-call cap.
 */
export const onlinePresenceRetentionTarget = (redis: {
  readonly sweepOnlinePresence: (limit: number) => Promise<number>;
}): RetentionTarget => ({
  name: 'retention.presence_online',
  batchSize: 1000,
  maxBatches: 50,
  purge: ({ limit }) => redis.sweepOnlinePresence(limit),
});
