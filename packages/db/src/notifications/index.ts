import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import type { DatabaseEventSink } from '../instrumented';
import { notificationEmailOperations } from './email-jobs';
import { notificationInboxOperations } from './inbox';
import { notificationPreferenceOperations } from './preferences';
import { watchNotificationOperations } from './watch-fanout';

export {
  NOTIFICATION_EMAILS_PER_HOUR,
  type NotificationEmailClaim,
  type NotificationEmailDelivery,
  type NotificationEmailOutcome,
} from './email-jobs';
export { oweNotification, type InboxRow, type OwedNotification } from './inbox';
export { notificationPrivacyAdopter } from './privacy';

/** Notifications (WATCH-12, ADR 0124): the inbox, choices, Watch's fan-out and email jobs. */
export const notificationOperations = (deps: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  ...watchNotificationOperations(deps),
  ...notificationInboxOperations(deps),
  ...notificationPreferenceOperations(deps),
  ...notificationEmailOperations(deps),
});
