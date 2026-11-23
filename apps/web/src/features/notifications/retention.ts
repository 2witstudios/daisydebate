import type { NotificationsStore } from '@daisy/db/stores/notifications';
import {
  DAY_MS,
  retentionAfter,
  type RetentionTarget,
} from '../../server/retention-target';

/** WATCH-12: a notification goes 90 days after it is read. */
export const notificationRetentionTarget = (
  database: Pick<NotificationsStore, 'purgeReadNotifications'>,
): RetentionTarget =>
  retentionAfter(
    'notifications',
    90 * DAY_MS,
    (batch) => database.purgeReadNotifications(batch),
    { maxBatches: 40 },
  );

/** ADR 0144: sent, failed and cancelled notification digests are kept 30 days. */
export const digestRetentionTarget = (
  database: Pick<NotificationsStore, 'purgeExpiredNotificationDigests'>,
): RetentionTarget =>
  retentionAfter('notification_digests', 30 * DAY_MS, (batch) =>
    database.purgeExpiredNotificationDigests(batch),
  );
