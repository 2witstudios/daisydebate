import Link from 'next/link';
import { Avatar } from '../../../../components/avatar/avatar';
import { DaisyLogo } from '../../../../components/daisy-mark/daisy-mark';
import { Icon } from '../../../../components/icon/icon';
import { NavItem } from '../../../../components/nav-item/nav-item';
import { navItemClass } from '../../../../components/nav-item/nav-item-class';
import { viewerStatus } from '../../../../friends/friends';
import type { ShellAccount } from '../../account';
import {
  memberDestinations,
  moreDestination,
  notificationsDestination,
  primaryDestinations,
  profileHref,
  wayIn,
} from '../destinations';
import { FriendsLink } from './friends-link';

/** A member's own places, listed after the launched destinations. */
function MemberPlaces({ account }: { readonly account: ShellAccount }) {
  if (account.state !== 'member') return null;
  const notifications = notificationsDestination();
  return (
    <>
      <li>
        <NavItem {...memberDestinations.messages} />
      </li>
      {notifications ? (
        <li>
          <NavItem {...notifications} />
        </li>
      ) : null}
      <li>
        <FriendsLink />
      </li>
    </>
  );
}

/** The foot's account item: a member's profile, or a visitor's way in. */
function AccountItem({ account }: { readonly account: ShellAccount }) {
  if (account.state !== 'member') {
    const { href, label } = wayIn(account);
    return (
      <li>
        <Link href={href} title={label} className={navItemClass(false)}>
          <Icon name="person" size={20} />
          <span className="sr-only">{label}</span>
        </Link>
      </li>
    );
  }
  return (
    <li>
      <Link
        href={profileHref(account.username)}
        aria-label={`Your profile, ${account.username}`}
        title="Profile"
        className="flex size-nav-target items-center justify-center rounded-round no-underline hover:bg-surface-overlay hover:no-underline"
      >
        <Avatar name={account.username} presence={viewerStatus} size="md" />
      </Link>
    </li>
  );
}

/**
 * The one navigation rail on every shell page, beside the page: the logo,
 * the launched destinations, a member's messages, notifications (once
 * launched) and friends at the top; More and the profile (or a visitor's way
 * in) pinned to the foot of the viewport. Icons only; each link carries its
 * name as screen-reader text and a tooltip. The rail sticks to the viewport
 * at every height, so the foot never scrolls with the page. Gives way to the
 * tab bar on a phone.
 */
export function Rail({ account }: { readonly account: ShellAccount }) {
  return (
    <div className="z-20 self-stretch border-r border-border bg-surface area-rail max-narrow:hidden">
      <nav
        aria-label="Primary"
        className="sticky top-0 flex h-screen flex-col items-center gap-2 py-2"
      >
        <Link
          href="/"
          aria-label="Daisy Debate home"
          title="Daisy Debate"
          className="flex size-nav-target items-center justify-center no-underline hover:no-underline"
        >
          <DaisyLogo />
        </Link>
        <ul className="flex list-none flex-col gap-1">
          {primaryDestinations.map((item) => (
            <li key={item.label}>
              <NavItem {...item} />
            </li>
          ))}
          <MemberPlaces account={account} />
        </ul>
        <ul className="mt-auto flex list-none flex-col items-center gap-1">
          <li>
            <NavItem {...moreDestination} />
          </li>
          <AccountItem account={account} />
        </ul>
      </nav>
    </div>
  );
}
