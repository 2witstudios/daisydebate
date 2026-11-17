import type { SearchParams } from '../access/decision';
import {
  notificationRows,
  parseNotificationsQuery,
  notificationsHref,
  type NotificationItem,
  type NotificationRow,
  type NotificationsCursor,
  type NotificationsQuery,
} from './notifications';

export type NotificationsListing = {
  readonly query: NotificationsQuery;
  readonly rows: readonly NotificationRow[];
  readonly unread: number;
  /** The next page's address, or null on the last page. */
  readonly olderHref: string | null;
};

/** The notifications page's listing over what the viewer's store read returned. */
export function getNotifications(
  params: SearchParams,
  items: readonly NotificationItem[],
  unread: number,
  next: NotificationsCursor | null = null,
): NotificationsListing {
  const query = parseNotificationsQuery(params);
  return {
    query,
    rows: notificationRows(items, query),
    unread,
    olderHref: next ? notificationsHref({ ...query, after: next }) : null,
  };
}
