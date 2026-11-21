import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import type { DatabaseEventSink } from '../instrumented';
import { notificationDigestOperations } from './digests';
import { notificationInboxOperations } from './inbox';
import { notificationPreferenceOperations } from './preferences';
import { notificationPresentationOperations } from './presentation';
import { watchNotificationOperations } from './watch-fanout';

export {
  type NotificationDigestDelivery,
  type NotificationDigestOutcome,
} from './digests';
export { type InboxCursor, type InboxRow } from './inbox';
export { oweNotifications } from './owe';
export { notificationPrivacyAdopter } from './privacy';

/**
 * Notifications (WATCH-12, ADR 0124, ADR 0144): the inbox, choices and
 * presentation, Watch's fan-out and the batched email.
 */
export const notificationOperations = (deps: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  ...watchNotificationOperations(deps),
  ...notificationInboxOperations(deps),
  ...notificationPreferenceOperations(deps),
  ...notificationPresentationOperations(deps),
  ...notificationDigestOperations(deps),
});
