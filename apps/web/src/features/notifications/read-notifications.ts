import { participantAccess } from '@daisy/auth/authorization';
import { hostLobbyResource } from '../tab/operations/host-lobby-resource';
import type { Database } from '@daisy/db';
import type {
  NotificationItem,
  NotificationsCursor,
  NotificationsQuery,
} from './notifications';
import { notificationWords } from './notification-words';

const PAGE = 50;

/**
 * Whether a member may read one tournament lobby's notifications now (NTF-15):
 * the ordinary Tab read fences, so the inbox, its badge and its toasts all
 * show a tournament notification exactly when its lobby is readable to them.
 */
export const canReadTournamentInbox: NonNullable<
  Parameters<Database['readNotifications']>[0]['canReadTournament']
> = (facts) => {
  const account = facts.authorization.account;
  if (!account?.member || account.erased || !participantAccess(account))
    return false;
  const resource = hostLobbyResource(
    facts.lobby,
    facts.authorization.organization,
    facts.ownerActorId,
  );
  return resource.kind === 'lobby';
};

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
    canReadTournament: canReadTournamentInbox,
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
