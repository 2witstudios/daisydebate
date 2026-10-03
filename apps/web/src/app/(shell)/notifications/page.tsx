import type { Metadata } from 'next';
import type { SearchParams } from '../../../features/access/decision';
import { getNotifications } from '../../../features/notifications/get-notifications';
import { requireAccess } from '../../../lib/access';
import { NotificationsPage } from '../../../ui/notifications/notifications-page/notifications-page';

export const metadata: Metadata = { title: 'Notifications' };

export default async function Notifications({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/notifications', searchParams);
  return <NotificationsPage {...getNotifications(await searchParams)} />;
}
