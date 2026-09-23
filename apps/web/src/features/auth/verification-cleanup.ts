import type { Clock } from '@daisy/clock';
import type { Logger } from '@daisy/logger';
import {
  createRetentionSweep,
  startRetentionSweep,
} from '../../server/retention-sweep';

const HOUR_MS = 3_600_000;
/** AUTH-7.5: expired rows are kept for a 24-hour grace before deletion. */
const GRACE_MS = 24 * HOUR_MS;

/**
 * Bounded, idempotent retention of expired verification records
 * (AUTH-7.5a), over the shared retention sweep loop.
 */
export function createVerificationCleanup({
  purge,
  clock,
  logger,
  graceMs = GRACE_MS,
  batchSize,
  maxBatches,
}: {
  readonly purge: (input: {
    readonly before: string;
    readonly limit: number;
  }) => Promise<number>;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly graceMs?: number;
  readonly batchSize?: number;
  readonly maxBatches?: number;
}) {
  return createRetentionSweep({
    purge,
    clock,
    logger,
    retentionMs: graceMs,
    ...(batchSize === undefined ? {} : { batchSize }),
    ...(maxBatches === undefined ? {} : { maxBatches }),
    completedEvent: 'auth.cleanup.completed',
    failedEvent: 'auth.cleanup.failed',
    operation: 'auth.cleanup.verification',
  });
}

type SweepOptions = Parameters<typeof startRetentionSweep>[0];

/** Hourly schedule inside the existing server process (no new service). */
export function startVerificationCleanup({
  cleanup,
  timers,
  intervalMs,
  runOnStart,
}: Omit<SweepOptions, 'sweep'> & {
  readonly cleanup: SweepOptions['sweep'];
}) {
  return startRetentionSweep({
    sweep: cleanup,
    timers,
    ...(intervalMs === undefined ? {} : { intervalMs }),
    ...(runOnStart === undefined ? {} : { runOnStart }),
  });
}
