import { instantMs } from '@daisy/clock';
import { idSchema } from '@daisy/protocol/primitives';
import type { SearchParams } from '../access/decision';

/** A position in the list: the last row the page before showed. */
export type NotificationsCursor = {
  readonly surfacedAt: string;
  readonly id: string;
};

export type NotificationsQuery = {
  readonly unreadOnly: boolean;
  /** Null on the first page. */
  readonly after: NotificationsCursor | null;
};

const first = (value: string | readonly string[] | undefined) =>
  typeof value === 'string' ? value : value?.[0];

/** `<epoch ms>-<id>`: short, and needs no escaping in an address. */
const cursorWords = (cursor: NotificationsCursor) =>
  `${instantMs(cursor.surfacedAt)}-${cursor.id}`;

const parseCursor = (value: string | undefined): NotificationsCursor | null => {
  const match = value === undefined ? null : /^(\d{1,15})-(.+)$/.exec(value);
  if (!match || !idSchema.safeParse(match[2]).success) return null;
  return {
    surfacedAt: new Date(Number(match[1])).toISOString(),
    id: match[2]!,
  };
};

export const parseNotificationsQuery = (
  params: SearchParams,
): NotificationsQuery => ({
  unreadOnly: first(params['show']) === 'unread',
  after: parseCursor(first(params['after'])),
});

/** The address for a query; defaults are left out. */
export const notificationsHref = (query: NotificationsQuery): string => {
  const search = new URLSearchParams();
  if (query.unreadOnly) search.set('show', 'unread');
  if (query.after) search.set('after', cursorWords(query.after));
  const words = search.toString();
  return words === '' ? '/notifications' : `/notifications?${words}`;
};

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
