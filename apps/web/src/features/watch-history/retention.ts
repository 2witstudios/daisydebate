import type { WatchHistoryStore } from '@daisy/db/stores/watch-history';
import {
  DAY_MS,
  retentionAfter,
  type RetentionTarget,
} from '../../server/retention-target';

/** SPECT-1.4: a Round leaves watch history a year after the last visit. */
export const watchHistoryRetentionTarget = (
  database: Pick<WatchHistoryStore, 'purgeExpiredWatchHistory'>,
): RetentionTarget =>
  retentionAfter(
    'watch_history',
    365 * DAY_MS,
    (batch) => database.purgeExpiredWatchHistory(batch),
    { batchSize: 1000 },
  );
