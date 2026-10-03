import type { SearchParams } from '../access/decision';
import { sampleNotifications } from '../../ui/mock/notifications';
import {
  notificationRows,
  parseNotificationsQuery,
  unreadCount,
  type NotificationRow,
  type NotificationsQuery,
} from './notifications';

export type NotificationsListing = {
  readonly query: NotificationsQuery;
  readonly rows: readonly NotificationRow[];
  readonly unread: number;
};

/**
 * The notifications page's one data seam: the viewer's notifications. Today
 * it reads samples and the address says what has been read; the stored
 * notifications replace this function and nothing else.
 */
export function getNotifications(params: SearchParams): NotificationsListing {
  const query = parseNotificationsQuery(params);
  return {
    query,
    rows: notificationRows(sampleNotifications, query),
    unread: query.allRead ? 0 : unreadCount(sampleNotifications),
  };
}
