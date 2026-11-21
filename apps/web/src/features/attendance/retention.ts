import type { Database } from '@daisy/db';
import {
  DAY_MS,
  retentionAfter,
  type RetentionTarget,
} from '../../server/retention-target';

export const checkInRetentionTarget = (
  database: Pick<Database, 'purgeExpiredRoundCheckInAttempts'>,
): RetentionTarget =>
  retentionAfter('round_check_in_attempts', DAY_MS, (batch) =>
    database.purgeExpiredRoundCheckInAttempts(batch),
  );
