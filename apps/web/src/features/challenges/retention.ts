import { type ChallengesStore } from '@daisy/db/stores/challenges';
import {
  retentionAfter,
  type RetentionTarget,
} from '../../server/retention-target';

/** Offers past their time; the list already ignores them (ADR 0103). */
export const challengeRetentionTarget = (
  database: Pick<ChallengesStore, 'purgeExpiredChallenges'>,
): RetentionTarget =>
  retentionAfter(
    'challenges',
    0,
    ({ before, limit }) =>
      database.purgeExpiredChallenges({ now: before, limit }),
    { batchSize: 1000, maxBatches: 50 },
  );
