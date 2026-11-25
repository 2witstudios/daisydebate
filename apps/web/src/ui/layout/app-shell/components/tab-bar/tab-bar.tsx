'use client';

import { ShellLink as Link } from '../../shell-link';
import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { cn } from '../../../../cn';
import { Icon, type IconName } from '../../../../components/icon/icon';
import { itemActive } from '../../../../components/nav-item/nav-item';
import { useFriendsOnline } from '../../../../friends/use-friends-online';
import { LegalLine } from '../rail/more-menu';
import { SignOutForm } from '../../../../components/sign-out-form/sign-out-form';
import type { ShellAccount } from '../../account';
import { useMessagesUnread } from '../../../../messaging/messages-unread-provider';
import {
  UnreadBadge,
  useUnreadNotifications,
} from '../rail/notifications-link';
import {
  friendsLabel,
  memberDestinations,
  messagesLabel,
  legalLinks,
  notificationsLabel,
  moreDestination,
  morePagesFor,
  primaryDestinations,
  wayIn,
} from '../destinations';

type Tab = {
  readonly href: string;
  readonly icon: IconName;
  readonly label: string;
  readonly alsoActive?: readonly string[];
};

const tabClass = (active: boolean): string =>
  cn(
    'flex h-tab cursor-pointer list-none flex-col items-center justify-center gap-1 text-xs no-underline hover:no-underline',
    active ? 'font-semibold text-ink' : 'text-ink-muted hover:text-ink',
  );

const sheetLinkClass =
  'flex min-h-tab items-center rounded-md px-4 text-base text-ink no-underline hover:bg-surface-overlay hover:no-underline';

/** The destinations that get a tab of their own. */
const tabbed = new Set(['/', '/lobby', '/judge']);

/** The four tabs before More: Home, Play, Judge, and Inbox or the way in. */
const tabsFor = (account: ShellAccount): readonly Tab[] => [
  ...primaryDestinations.filter((item) => tabbed.has(item.href)),
  account.state === 'member'
    ? { ...memberDestinations.messages, label: 'Inbox' }
    : { ...wayIn(account), icon: 'person' },
];

/** Everything the four tabs leave out, as More lists it. */
const moreLinksFor = (
  account: ShellAccount,
  online: number,
  unread: number,
): readonly { readonly href: string; readonly label: string }[] => [
  ...primaryDestinations
    .filter((item) => !tabbed.has(item.href))
    .flatMap((item) =>
      item.subItems
        ? item.subItems.map((sub) => ({
            href: sub.href,
            label: sub.href === item.href ? item.label : sub.label,
          }))
        : [item],
    ),
  ...(account.state === 'member'
    ? [
        {
          href: memberDestinations.notifications.href,
          label: notificationsLabel(unread),
        },
        {
          href: memberDestinations.friends.href,
          label: friendsLabel(online),
        },
      ]
    : []),
  ...morePagesFor(account),
];

/**
 * The phone's navigation, fixed along the bottom in place of the rail: Home,
 * Play, Judge, a member's Inbox (a visitor's way in), and More, a sheet with
 * every other destination, headed by a member's own card, then Sign out and
 * the legal pages. More is a native disclosure, so it opens before
 * any script; it closes on arriving at another page.
 */
export function TabBar({
  account,
  selfCard,
}: {
  readonly account: ShellAccount;
  /** The member's own card, at the top of More. */
  readonly selfCard?: ReactNode;
}) {
  const pathname = usePathname();
  const online = useFriendsOnline(account.state === 'member') ?? 0;
  const unread = useUnreadNotifications();
  const messages = useMessagesUnread();
  const moreLinks = moreLinksFor(account, online, unread);
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 hidden grid-cols-5 border-t border-border bg-surface px-1 pt-1 tab-bar-safe max-narrow:grid"
    >
      {tabsFor(account).map((tab) => {
        const active = itemActive(pathname, tab.href, [], tab.alsoActive);
        return (
          <Link
            prefetch={active ? false : null}
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            aria-label={
              tab.href === memberDestinations.messages.href
                ? messagesLabel(messages, tab.label)
                : undefined
            }
            className={tabClass(active)}
          >
            <span className="relative px-2">
              <Icon name={tab.icon} size={20} />
              {tab.href === memberDestinations.messages.href ? (
                <UnreadBadge unread={messages} />
              ) : null}
            </span>
            {tab.label}
          </Link>
        );
      })}
      {/* Keyed by the path, so arriving at a page closes the sheet. */}
      <details key={pathname}>
        <summary
          className={tabClass(
            [...moreLinks, ...legalLinks].some((link) =>
              itemActive(pathname, link.href),
            ),
          )}
        >
          {/* Notifications live in More on a phone, so More carries their count. */}
          <span className="relative px-2">
            <Icon name={moreDestination.icon} size={20} />
            <UnreadBadge unread={unread} />
          </span>
          {moreDestination.label}
        </summary>
        <div className="fixed inset-x-0 more-sheet flex flex-col overflow-y-auto border-t border-border bg-surface-raised shadow-3">
          {selfCard ? <div className="px-2 pt-2">{selfCard}</div> : null}
          <ul aria-label="More" className="flex list-none flex-col p-2">
            {moreLinks.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  aria-current={
                    itemActive(pathname, link.href) ? 'page' : undefined
                  }
                  className={sheetLinkClass}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
          {account.state === 'member' ? (
            <div className="px-2">
              <SignOutForm
                next="/"
                look={{ variant: 'row' }}
                className="w-full"
              />
            </div>
          ) : null}
          <LegalLine sheet />
        </div>
      </details>
    </nav>
  );
}
