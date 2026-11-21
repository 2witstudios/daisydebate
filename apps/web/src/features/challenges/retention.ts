import type { Database } from '@daisy/db';
import {
  retentionAfter,
  type RetentionTarget,
} from '../../server/retention-target';

/** Offers past their time; the list already ignores them (ADR 0103). */
export const challengeRetentionTarget = (
  database: Pick<Database, 'purgeExpiredChallenges'>,
): RetentionTarget =>
  retentionAfter(
    'challenges',
    0,
    ({ before, limit }) =>
      database.purgeExpiredChallenges({ now: before, limit }),
    { batchSize: 1000, maxBatches: 50 },
  );
