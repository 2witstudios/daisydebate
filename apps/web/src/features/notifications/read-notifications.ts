import { participantAccess, insideBoundary } from '@daisy/auth/authorization';
import { hostLobbyResource } from '../tab/operations/host-lobby-resource';
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
    canReadTournament: (facts) => {
      const account = facts.authorization.account;
      if (!account?.member || account.erased || !participantAccess(account))
        return false;
      const resource = hostLobbyResource(
        facts.lobby,
        facts.authorization.organization,
        facts.ownerActorId,
      );
      return (
        resource.kind === 'lobby' &&
        insideBoundary(account.boundary, resource.scope)
      );
    },
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
