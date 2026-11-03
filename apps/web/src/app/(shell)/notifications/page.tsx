import type { Metadata } from 'next';
import type { SearchParams } from '../../../features/access/decision';
import { getNotifications } from '../../../features/notifications/get-notifications';
import { requireAccess } from '../../../lib/access';
import {
  requestIdentity,
  requestNotifications,
} from '../../../lib/request-session';
import { parseNotificationsQuery } from '../../../features/notifications/notifications';
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from '../audience/actions';
import { NotificationsPage } from '../../../ui/notifications/notifications-page/notifications-page';

export const metadata: Metadata = { title: 'Notifications' };

export default async function Notifications({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/notifications', searchParams);
  const params = await searchParams;
  const identity = await requestIdentity();
  const { items, unread } =
    'principal' in identity && identity.principal.kind === 'user'
      ? await requestNotifications(
          identity.principal.userId,
          parseNotificationsQuery(params).unreadOnly,
        )
      : { items: [], unread: 0 };
  return (
    <NotificationsPage
      {...getNotifications(params, items, unread)}
      markRead={(id) => markNotificationReadAction.bind(null, id)}
      markAllRead={markAllNotificationsReadAction}
    />
  );
}
