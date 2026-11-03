import type { SearchParams } from '../access/decision';

export type NotificationsQuery = {
  readonly unreadOnly: boolean;
};

const first = (value: string | readonly string[] | undefined) =>
  typeof value === 'string' ? value : value?.[0];

export const parseNotificationsQuery = (
  params: SearchParams,
): NotificationsQuery => ({
  unreadOnly: first(params['show']) === 'unread',
});

/** The address for a query; defaults are left out. */
export const notificationsHref = (query: NotificationsQuery): string =>
  query.unreadOnly ? '/notifications?show=unread' : '/notifications';

/** One notification as the viewer's list reads it. */
export type NotificationItem = {
  readonly id: string;
  readonly text: string;
  /** Where the notification leads. */
  readonly href: string;
  /** Minutes before now. */
  readonly minutesAgo: number;
  readonly unread: boolean;
};

export type NotificationRow = NotificationItem & {
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

/** The rows to show for a query. */
export const notificationRows = (
  items: readonly NotificationItem[],
  query: NotificationsQuery,
): readonly NotificationRow[] =>
  items
    .map((item) => ({ ...item, when: ago(item.minutesAgo) }))
    .filter((row) => !query.unreadOnly || row.unread);
