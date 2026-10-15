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
  primaryDestinations,
  profileHref,
  wayIn,
} from '../destinations';
import { FriendsLink } from './friends-link';

/** The rail's foot: a member's own places and profile, or the way in. */
function AccountItems({ account }: { readonly account: ShellAccount }) {
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
  const { messages, notifications } = memberDestinations;
  return (
    <>
      <li>
        <NavItem {...messages} />
      </li>
      <li>
        <NavItem {...notifications} />
      </li>
      <li>
        <FriendsLink />
      </li>
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
    </>
  );
}

/**
 * The one navigation rail on every shell page, beside the page: the logo,
 * the eight destinations and More at the top, a member's messages,
 * notifications, friends and profile (or a visitor's way in) at the foot.
 * Icons only; each link carries its name as screen-reader text and a
 * tooltip. Its column runs the page's full height; its content is pinned to
 * the viewport only where the viewport can hold all of it. Gives way to the
 * tab bar on a phone.
 */
export function Rail({ account }: { readonly account: ShellAccount }) {
  return (
    <div className="z-20 self-stretch border-r border-border bg-surface area-rail max-narrow:hidden">
      <nav
        aria-label="Primary"
        className="flex flex-col items-center gap-2 py-2 tall:sticky tall:top-0 tall:h-screen"
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
          {[...primaryDestinations, moreDestination].map((item) => (
            <li key={item.label}>
              <NavItem {...item} />
            </li>
          ))}
        </ul>
        <ul className="mt-auto flex list-none flex-col items-center gap-1 border-t border-border pt-2">
          <AccountItems account={account} />
        </ul>
      </nav>
    </div>
  );
}
