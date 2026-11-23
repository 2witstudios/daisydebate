import type { Metadata } from 'next';
import type { SearchParams } from '../../../features/access/decision';
import { getNotifications } from '../../../features/notifications/get-notifications';
import { requireAccess } from '../../../features/access/page-access';
import { requestIdentity } from '../../../lib/page-reads';
import { requestNotifications } from '../../../features/notifications/page-reads';
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
  const { items, unread, next } =
    'principal' in identity && identity.principal.kind === 'user'
      ? await requestNotifications(
          identity.principal.userId,
          parseNotificationsQuery(params),
        )
      : { items: [], unread: 0, next: null };
  return (
    <NotificationsPage
      {...getNotifications(params, items, unread, next)}
      markRead={(id) => markNotificationReadAction.bind(null, id)}
      markAllRead={markAllNotificationsReadAction}
    />
  );
}
