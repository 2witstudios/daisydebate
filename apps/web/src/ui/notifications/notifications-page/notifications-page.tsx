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
import type { FormStateAction } from '../../form-action/action-form';
import { MarkReadButton } from './mark-read-button';

type NotificationsPageProps = {
  readonly query: NotificationsQuery;
  readonly rows: readonly NotificationRow[];
  readonly unread: number;
  /** Marks one read, from its id; a native post. */
  readonly markRead: (id: string) => FormStateAction;
  readonly markAllRead: FormStateAction;
};

/** The viewer's notifications. The filter is a link to the next state. */
export function NotificationsPage({
  query,
  rows,
  unread,
  markRead,
  markAllRead,
}: NotificationsPageProps) {
  return (
    <ReadingPage>
      <PageHeader
        title="Notifications"
        lede={unread === 0 ? 'You are all caught up.' : `${unread} unread.`}
      />
      <TabLinks
        label="Filter notifications"
        tabs={[
          {
            id: 'all',
            label: 'All',
            href: notificationsHref({ unreadOnly: false }),
            selected: !query.unreadOnly,
          },
          {
            id: 'unread',
            label: 'Unread',
            href: notificationsHref({ unreadOnly: true }),
            selected: query.unreadOnly,
          },
        ]}
      />
      {unread > 0 ? (
        <MarkReadButton action={markAllRead} label="Mark all as read" />
      ) : null}
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
                  {row.unread ? (
                    <MarkReadButton
                      action={markRead(row.id)}
                      label="Mark as read"
                    />
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </ReadingPage>
  );
}
