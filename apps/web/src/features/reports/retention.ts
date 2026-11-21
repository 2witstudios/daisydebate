import type { Database } from '@daisy/db';
import {
  retentionAfter,
  type RetentionTarget,
} from '../../server/retention-target';

/** Closed reports past their proposed evidence retention (DEC-298). */
export const reportRetentionTarget = (
  database: Pick<Database, 'purgeClosedReports'>,
): RetentionTarget =>
  retentionAfter(
    'reports',
    0,
    ({ before, limit }) => database.purgeClosedReports({ now: before, limit }),
    { batchSize: 1000, maxBatches: 50 },
  );
