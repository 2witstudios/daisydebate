import type { Database } from '@daisy/db';
import type { NotificationKind } from '@daisy/protocol';
import type { NotificationItem } from './notifications';

const PAGE = 50;

/**
 * The words come from the kind and the names read now, so a row can carry no
 * outcome: there is nowhere in it for one, and nowhere here to add one.
 */
const textOf = (kind: NotificationKind, debater: string | null) =>
  kind === 'followed_debater_live'
    ? `@${debater ?? 'A debater you follow'} is on air.`
    : 'A recording is ready to watch.';

const hrefOf = (kind: NotificationKind, roundId: string) =>
  kind === 'followed_debater_live'
    ? `/watch/${roundId}`
    : `/recordings/${roundId}`;

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
  });
  const nowMs = Date.parse(input.now);
  return {
    unread,
    items: rows.map((row) => ({
      id: row.id,
      text: textOf(row.kind, row.debater),
      href: hrefOf(row.kind, row.roundId),
      minutesAgo: Math.max(
        0,
        Math.floor((nowMs - Date.parse(row.createdAt)) / 60_000),
      ),
      unread: row.readAt === null,
    })),
  };
};
