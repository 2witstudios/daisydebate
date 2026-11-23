import type { OutboxStore } from '@daisy/db/stores/outbox';
import {
  DAY_MS,
  retentionAfter,
  type RetentionTarget,
} from '../../server/retention-target';

/**
 * RT-2.2: the delivery log is kept 24 hours. Batches are smaller than
 * the others because the outbox is write-heavy (every announced write
 * inserts a row) and each delete batch is its own autocommitted
 * statement whose duration holds back `pg_snapshot_xmin` for the whole
 * cluster while it runs (`drainOutbox` depends on that watermark to
 * find a row final). Throughput bound: one hourly run must delete at
 * least the rows that became eligible since the last run. Sized for 10
 * rows/s (36,000 rows/hour): 200 batches of 200 is 40,000 rows per run
 * (~11.1 rows/s). A sustained rate above that never drains; raise the
 * batches, the batch size or the run frequency together if it does.
 */
export const outboxRetentionTarget = (
  database: Pick<OutboxStore, 'purgeExpiredOutboxEvents'>,
): RetentionTarget =>
  retentionAfter(
    'outbox',
    DAY_MS,
    (batch) => database.purgeExpiredOutboxEvents(batch),
    { batchSize: 200, maxBatches: 200 },
  );
