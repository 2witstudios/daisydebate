import type { Database } from '@daisy/db';
import type { NotificationItem } from './notifications';
import { notificationWords } from './notification-words';

const PAGE = 50;

/** An account's stored notifications as its list reads them. */
export const readNotificationItems = async (
  store: Pick<Database, 'readNotifications'>,
  input: {
    readonly userId: string;
    readonly unreadOnly: boolean;
    readonly now: string;
  },
): Promise<{
  readonly items: readonly NotificationItem[];
  readonly unread: number;
}> => {
  const { rows, unread } = await store.readNotifications({
    userId: input.userId,
    unreadOnly: input.unreadOnly,
    limit: PAGE,
    now: input.now,
  });
  const nowMs = Date.parse(input.now);
  return {
    unread,
    items: rows.map(({ id, readAt, createdAt, ...subject }) => ({
      id,
      ...notificationWords(subject),
      minutesAgo: Math.max(
        0,
        Math.floor((nowMs - Date.parse(createdAt)) / 60_000),
      ),
      unread: readAt === null,
    })),
  };
};
