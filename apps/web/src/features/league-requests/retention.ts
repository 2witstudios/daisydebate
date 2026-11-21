import type { Database } from '@daisy/db';
import {
  DAY_MS,
  retentionAfter,
  type RetentionTarget,
} from '../../server/retention-target';

/**
 * PYL-17: a League request holds its contact's personal data and is
 * kept 365 days after it was made, sent or not (compliance).
 */
export const leagueRequestRetentionTarget = (
  database: Pick<Database, 'purgeExpiredLeagueRequests'>,
): RetentionTarget =>
  retentionAfter('league_requests', 365 * DAY_MS, (batch) =>
    database.purgeExpiredLeagueRequests(batch),
  );
