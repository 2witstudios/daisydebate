import type { SearchParams } from '../access/decision';
import {
  notificationRows,
  parseNotificationsQuery,
  unreadCount,
  type NotificationItem,
  type NotificationRow,
  type NotificationsQuery,
} from './notifications';

export type NotificationsListing = {
  readonly query: NotificationsQuery;
  readonly rows: readonly NotificationRow[];
  readonly unread: number;
};

/**
 * The notifications page's one data seam: what the viewer's stored
 * notifications hold. Nothing stores one yet (WATCH-12), so the list is empty
 * and the launch flag keeps the place out of navigation.
 */
export function getNotifications(
  params: SearchParams,
  items: readonly NotificationItem[] = [],
): NotificationsListing {
  const query = parseNotificationsQuery(params);
  return {
    query,
    rows: notificationRows(items, query),
    unread: unreadCount(items),
  };
}
