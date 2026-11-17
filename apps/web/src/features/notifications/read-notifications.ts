import type { Database } from '@daisy/db';
import type {
  NotificationItem,
  NotificationsCursor,
  NotificationsQuery,
} from './notifications';
import { notificationWords } from './notification-words';

const PAGE = 50;

/** An account's stored notifications as its list reads them. */
export const readNotificationItems = async (
  store: Pick<Database, 'readNotifications'>,
  input: {
    readonly userId: string;
    readonly query: NotificationsQuery;
    readonly now: string;
  },
): Promise<{
  readonly items: readonly NotificationItem[];
  readonly unread: number;
  readonly next: NotificationsCursor | null;
}> => {
  const { rows, unread, next } = await store.readNotifications({
    userId: input.userId,
    unreadOnly: input.query.unreadOnly,
    after: input.query.after,
    limit: PAGE,
    now: input.now,
  });
  const nowMs = Date.parse(input.now);
  return {
    unread,
    next,
    items: rows.map(({ id, readAt, surfacedAt, ...subject }) => ({
      id,
      ...notificationWords(subject),
      minutesAgo: Math.max(
        0,
        Math.floor((nowMs - Date.parse(surfacedAt)) / 60_000),
      ),
      unread: readAt === null,
    })),
  };
};
