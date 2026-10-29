import Link from 'next/link';
import { Avatar } from '../../../../components/avatar/avatar';
import { DaisyLogo } from '../../../../components/daisy-mark/daisy-mark';
import { Icon } from '../../../../components/icon/icon';
import { NavItem } from '../../../../components/nav-item/nav-item';
import { navItemClass } from '../../../../components/nav-item/nav-item-class';
import { viewerStatus } from '../../../../friends/friends';
import { cn } from '../../../../cn';
import type { RailPreference } from '../../rail-preference';
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
function MemberPlaces({
  account,
  extended,
}: {
  readonly account: ShellAccount;
  readonly extended: boolean;
}) {
  if (account.state !== 'member') return null;
  const notifications = notificationsDestination();
  return (
    <>
      <li>
        <NavItem {...memberDestinations.messages} extended={extended} />
      </li>
      {notifications ? (
        <li>
          <NavItem {...notifications} extended={extended} />
        </li>
      ) : null}
      <li>
        <FriendsLink extended={extended} />
      </li>
    </>
  );
}

/** The foot's account item: a member's profile, or a visitor's way in. */
function AccountItem({
  account,
  extended,
}: {
  readonly account: ShellAccount;
  readonly extended: boolean;
}) {
  if (account.state !== 'member') {
    const { href, label } = wayIn(account);
    return (
      <li>
        <Link
          href={href}
          title={label}
          className={navItemClass(false, extended)}
        >
          <Icon name="person" size={20} />
          <span className={extended ? 'max-rail:sr-only' : 'sr-only'}>
            {label}
          </span>
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

export type RailProps = {
  readonly account: ShellAccount;
  /** The viewer's saved rail width, resolved per request (ADR 0091). */
  readonly rail: RailPreference;
  /** The server action the toggle form posts; it flips the saved choice. */
  readonly toggleRail: () => Promise<void>;
};

/**
 * The one navigation rail on every shell page, beside the page: the logo,
 * the launched destinations and a member's messages, notifications (once
 * launched) and friends at the top; More, the profile (or a visitor's way
 * in) and the rail toggle pinned to the foot of the viewport. Extended (the
 * default), each destination's name shows beside its icon and the toggle
 * offers Minimize; mini is icons only with names as screen-reader text and
 * a tooltip, and the toggle offers Expand. Below the rail breakpoint CSS
 * alone keeps every name intact and hides the toggle (ADR 0091). Hover
 * flyouts (Watch, More), badges and the avatar are the same in both modes;
 * a link at the foot opens its flyout upward. The rail sticks to the
 * viewport at every height, so the foot never scrolls with the page. Gives
 * way to the tab bar on a phone.
 */
export function Rail({ account, rail, toggleRail }: RailProps) {
  const extended = rail === 'extended';
  return (
    <div className="z-20 self-stretch border-r border-border bg-surface area-rail max-narrow:hidden">
      <nav
        aria-label="Primary"
        className={cn(
          'sticky top-0 flex h-dvh flex-col gap-2 py-2',
          extended
            ? 'items-stretch px-2 max-rail:items-center max-rail:px-0'
            : 'items-center',
        )}
      >
        <Link
          href="/"
          aria-label="Daisy Debate home"
          title="Daisy Debate"
          className="flex size-nav-target items-center justify-center no-underline hover:no-underline"
        >
          <DaisyLogo />
        </Link>
        <ul
          className={cn(
            'flex list-none flex-col gap-1',
            extended && 'w-full items-stretch max-rail:items-center',
          )}
        >
          {primaryDestinations.map((item) => (
            <li key={item.label}>
              <NavItem {...item} extended={extended} />
            </li>
          ))}
          <MemberPlaces account={account} extended={extended} />
        </ul>
        <ul
          className={cn(
            'mt-auto flex list-none flex-col gap-1',
            extended
              ? 'w-full items-stretch max-rail:items-center'
              : 'items-center',
          )}
        >
          <li>
            <NavItem
              {...moreDestination}
              flyoutAlign="bottom"
              extended={extended}
            />
          </li>
          <AccountItem account={account} extended={extended} />
        </ul>
        <form action={toggleRail} className="max-rail:hidden">
          <button
            type="submit"
            title={extended ? undefined : 'Expand rail'}
            className={navItemClass(false, extended)}
          >
            <Icon name={extended ? 'railMinimize' : 'railExpand'} size={20} />
            <span className={extended ? 'max-rail:sr-only' : 'sr-only'}>
              {extended ? 'Minimize' : 'Expand'}
            </span>
          </button>
        </form>
      </nav>
    </div>
  );
}
