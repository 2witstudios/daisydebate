import type { Database } from '@daisy/db';
import {
  DAY_MS,
  retentionAfter,
  type RetentionTarget,
} from '../../server/retention-target';

/**
 * SUPP-1: a support message holds its sender's personal data and is kept
 * 365 days after it was sent, emailed or not (compliance).
 */
export const supportMessageRetentionTarget = (
  database: Pick<Database, 'purgeExpiredSupportMessages'>,
): RetentionTarget =>
  retentionAfter('support_messages', 365 * DAY_MS, (batch) =>
    database.purgeExpiredSupportMessages(batch),
  );
