import type { Database } from '@daisy/db';
import {
  DAY_MS,
  retentionAfter,
  type RetentionTarget,
} from '../../server/retention-target';

/** ADR 0144: ended unread-messages emails are kept 30 days. */
export const unreadMailRetentionTarget = (
  database: Pick<Database, 'purgeExpiredMessagingUnreadEmails'>,
): RetentionTarget =>
  retentionAfter('messaging_unread_emails', 30 * DAY_MS, (batch) =>
    database.purgeExpiredMessagingUnreadEmails(batch),
  );
