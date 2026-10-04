import Link from 'next/link';
import {
  notificationsHref,
  type NotificationRow,
  type NotificationsQuery,
} from '../../../features/notifications/notifications';
import { Badge } from '../../components/badge/badge';
import { PageHeader } from '../../components/page-header/page-header';
import { Panel } from '../../components/panel/panel';
import { TabLinks } from '../../components/tab-links/tab-links';
import { ReadingPage } from '../../components/reading-page/reading-page';

type NotificationsPageProps = {
  readonly query: NotificationsQuery;
  readonly rows: readonly NotificationRow[];
  readonly unread: number;
};

/** The viewer's notifications. Every control is a link to the next state. */
export function NotificationsPage({
  query,
  rows,
  unread,
}: NotificationsPageProps) {
  return (
    <ReadingPage>
      <PageHeader
        title="Notifications"
        lede={unread === 0 ? 'You are all caught up.' : `${unread} unread.`}
        actions={
          unread === 0 ? null : (
            <Link
              href={notificationsHref({ ...query, allRead: true })}
              className="text-sm font-bold"
            >
              Mark all as read
            </Link>
          )
        }
      />
      <TabLinks
        label="Filter notifications"
        tabs={[
          {
            id: 'all',
            label: 'All',
            href: notificationsHref({ ...query, unreadOnly: false }),
            selected: !query.unreadOnly,
          },
          {
            id: 'unread',
            label: 'Unread',
            href: notificationsHref({ ...query, unreadOnly: true }),
            selected: query.unreadOnly,
          },
        ]}
      />
      <Panel title={query.unreadOnly ? 'Unread' : 'Recent'}>
        {rows.length === 0 ? (
          <p className="text-base text-ink-muted">Nothing here.</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <Link href={row.href} className="text-base">
                  {row.text}
                </Link>
                <span className="flex items-center gap-2 text-sm text-ink-muted">
                  {row.unread ? <Badge tone="accent">New</Badge> : null}
                  {row.when}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </ReadingPage>
  );
}
