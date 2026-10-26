'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '../../../../cn';
import { Icon, type IconName } from '../../../../components/icon/icon';
import { itemActive } from '../../../../components/nav-item/nav-item';
import { onlineNow } from '../../../../friends/friends';
import { useUiState } from '../../../../store/store';
import type { ShellAccount } from '../../account';
import {
  friendsLabel,
  memberDestinations,
  moreDestination,
  primaryDestinations,
  profileHref,
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
          href: memberDestinations.friends.href,
          label: friendsLabel(online),
        },
        { href: profileHref(account.username), label: 'Profile' },
      ]
    : []),
  ...(moreDestination.subItems ?? []),
];

/**
 * The phone's navigation, fixed along the bottom in place of the rail: Home,
 * Play, Judge, a member's Inbox (a visitor's way in), and More, a sheet with
 * every other destination. More is a native disclosure, so it opens before
 * any script; it closes on arriving at another page.
 */
export function TabBar({ account }: { readonly account: ShellAccount }) {
  const pathname = usePathname();
  const online = useUiState((state) =>
    onlineNow(state.collections.onlineUsers),
  );
  const moreLinks = moreLinksFor(account, online);
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 hidden grid-cols-5 border-t border-border bg-surface px-1 pt-1 tab-bar-safe max-narrow:grid"
    >
      {tabsFor(account).map((tab) => {
        const active = itemActive(pathname, tab.href, [], tab.alsoActive);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={tabClass(active)}
          >
            <Icon name={tab.icon} size={20} />
            {tab.label}
          </Link>
        );
      })}
      {/* Keyed by the path, so arriving at a page closes the sheet. */}
      <details key={pathname}>
        <summary
          className={tabClass(
            moreLinks.some((link) => itemActive(pathname, link.href)),
          )}
        >
          <Icon name={moreDestination.icon} size={20} />
          {moreDestination.label}
        </summary>
        <ul
          aria-label="More"
          className="fixed inset-x-0 more-sheet flex list-none flex-col overflow-y-auto border-t border-border bg-surface-raised p-2 shadow-3"
        >
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
      </details>
    </nav>
  );
}
