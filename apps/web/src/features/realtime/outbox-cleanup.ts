import type { Clock } from '@daisy/clock';
import type { Logger } from '@daisy/logger';
import {
  createRetentionSweep,
  startRetentionSweep,
} from '../../server/retention-sweep';

const HOUR_MS = 3_600_000;
/** Plan retention window for the delivery log (24h "for example"). */
const RETENTION_MS = 24 * HOUR_MS;
/**
 * Smaller than the shared sweep's 500-row default: the outbox is
 * write-heavy (every announced write inserts a row, unlike verification),
 * and each delete batch is its own short autocommitted transaction whose
 * duration holds back `pg_snapshot_xmin` for the whole cluster while it
 * runs (`drainOutbox` depends on that watermark to find a row final).
 * Smaller batches keep each one brief regardless of table size.
 */
const BATCH_SIZE = 200;
/**
 * Throughput bound: at steady state (retention already caught up once),
 * one hourly run must delete at least as many rows as become eligible
 * since the last run — the sustained append rate times the interval.
 * Sized for an expected write rate of 10 rows/s: 10 * 3600s = 36,000
 * rows/hour, so `maxBatches * BATCH_SIZE` (200 * 200 = 40,000) clears that
 * with headroom (~11.1 rows/s). A sustained rate above that bound never
 * drains and the outbox grows without limit; raise `maxBatches`, the
 * batch size or the run frequency together if the real rate exceeds it.
 */
const MAX_BATCHES = 200;

/** RT-2.2, plan "Maintenance prunes the outbox after a retention window". */
export function createOutboxCleanup({
  purge,
  clock,
  logger,
  retentionMs = RETENTION_MS,
  batchSize = BATCH_SIZE,
  maxBatches = MAX_BATCHES,
}: {
  readonly purge: (input: {
    readonly before: string;
    readonly limit: number;
  }) => Promise<number>;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly retentionMs?: number;
  readonly batchSize?: number;
  readonly maxBatches?: number;
}) {
  return createRetentionSweep({
    purge,
    clock,
    logger,
    retentionMs,
    batchSize,
    maxBatches,
    completedEvent: 'realtime.cleanup.completed',
    failedEvent: 'realtime.cleanup.failed',
    operation: 'realtime.cleanup.outbox',
  });
}

type SweepOptions = Parameters<typeof startRetentionSweep>[0];

export function startOutboxCleanup({
  cleanup,
  timers,
  intervalMs,
  runOnStart,
}: Omit<SweepOptions, 'sweep'> & { readonly cleanup: SweepOptions['sweep'] }) {
  return startRetentionSweep({
    sweep: cleanup,
    timers,
    ...(intervalMs === undefined ? {} : { intervalMs }),
    ...(runOnStart === undefined ? {} : { runOnStart }),
  });
}
