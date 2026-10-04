import type { SearchParams } from '../access/decision';
import type { MockNotification } from '../../ui/mock/notifications';

export type NotificationsQuery = {
  readonly unreadOnly: boolean;
  /** Every notification marked read, as the viewer asked. */
  readonly allRead: boolean;
};

const first = (value: string | readonly string[] | undefined) =>
  typeof value === 'string' ? value : value?.[0];

export const parseNotificationsQuery = (
  params: SearchParams,
): NotificationsQuery => ({
  unreadOnly: first(params['show']) === 'unread',
  allRead: first(params['read']) === 'all',
});

/** The address for a query; defaults are left out. */
export function notificationsHref(query: NotificationsQuery): string {
  const params = new URLSearchParams();
  if (query.unreadOnly) params.set('show', 'unread');
  if (query.allRead) params.set('read', 'all');
  const text = params.toString();
  return text === '' ? '/notifications' : `/notifications?${text}`;
}

export type NotificationRow = MockNotification & {
  /** Minutes in words: `12 minutes ago`. */
  readonly when: string;
};

const ago = (minutes: number): string => {
  const [value, unit] =
    minutes < 60
      ? [minutes, 'minute']
      : minutes < 60 * 24
        ? [Math.floor(minutes / 60), 'hour']
        : [Math.floor(minutes / (60 * 24)), 'day'];
  return `${value} ${unit}${value === 1 ? '' : 's'} ago`;
};

/** The rows to show for a query, each read once everything is marked read. */
export function notificationRows(
  items: readonly MockNotification[],
  query: NotificationsQuery,
): readonly NotificationRow[] {
  return items
    .map((item) => ({
      ...item,
      unread: item.unread && !query.allRead,
      when: ago(item.minutesAgo),
    }))
    .filter((row) => !query.unreadOnly || row.unread);
}

export const unreadCount = (items: readonly MockNotification[]): number =>
  items.filter((item) => item.unread).length;
