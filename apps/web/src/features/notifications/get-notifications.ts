import type { SearchParams } from '../access/decision';
import {
  notificationRows,
  parseNotificationsQuery,
  type NotificationItem,
  type NotificationRow,
  type NotificationsQuery,
} from './notifications';

export type NotificationsListing = {
  readonly query: NotificationsQuery;
  readonly rows: readonly NotificationRow[];
  readonly unread: number;
};

/** The notifications page's listing over what the viewer's store read returned. */
export function getNotifications(
  params: SearchParams,
  items: readonly NotificationItem[],
  unread: number,
): NotificationsListing {
  const query = parseNotificationsQuery(params);
  return {
    query,
    rows: notificationRows(items, query),
    unread,
  };
}
