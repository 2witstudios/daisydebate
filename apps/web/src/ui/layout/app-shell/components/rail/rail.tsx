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

/**
 * The foot's account item: a member's avatar, with the username beside it
 * when extended, or a visitor's way in. Extended, it takes the row's free
 * width; below the rail breakpoint it is the avatar alone.
 */
function AccountItem({
  account,
  extended,
}: {
  readonly account: ShellAccount;
  readonly extended: boolean;
}) {
  const grow = extended ? 'min-w-0 flex-1 max-rail:flex-none' : undefined;
  if (account.state !== 'member') {
    const { href, label } = wayIn(account);
    return (
      <li className={grow}>
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
    <li className={grow}>
      <Link
        href={profileHref(account.username)}
        aria-label={`Your profile, ${account.username}`}
        title="Profile"
        className={cn(
          'flex items-center rounded-md no-underline hover:bg-surface-overlay hover:no-underline',
          extended
            ? 'h-nav-target w-full min-w-0 gap-3 px-2 max-rail:w-nav-target max-rail:justify-center max-rail:gap-0 max-rail:px-0'
            : 'size-nav-target justify-center',
        )}
      >
        <Avatar name={account.username} presence={viewerStatus} size="sm" />
        {extended ? (
          <span
            aria-hidden="true"
            className="min-w-0 truncate text-sm font-semibold text-ink max-rail:hidden"
          >
            {account.username}
          </span>
        ) : null}
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
 * launched) and friends at the top; the foot pinned to the viewport. Extended
 * (the default), the logo carries the Daisy Debate wordmark, each
 * destination's name shows beside its icon, and the foot is one row above a
 * divider: the profile on the left, then More and the minimize control as
 * icon buttons. Mini is icons only, with names as screen-reader text and a
 * tooltip; its foot stacks More, the profile and the expand control. Below
 * the rail breakpoint CSS alone keeps every name intact and hides the
 * wordmark, the username and the toggle (ADR 0091). Hover flyouts (Watch,
 * More) and badges are the same in both modes; a link at the foot opens its
 * flyout upward. The rail sticks to the viewport at every height, so the
 * foot never scrolls with the page. Gives way to the tab bar on a phone.
 */
export function Rail({ account, rail, toggleRail }: RailProps) {
  const extended = rail === 'extended';
  const more = (
    <li>
      <NavItem
        {...moreDestination}
        iconOnly
        flyoutAlign="bottom"
        extended={extended}
      />
    </li>
  );
  return (
    <div className="z-20 self-stretch border-r border-border bg-surface area-rail max-narrow:hidden">
      <nav
        aria-label="Primary"
        className={cn(
          'sticky top-0 flex h-screen flex-col gap-2 py-2',
          extended
            ? 'items-stretch px-2 max-rail:items-center max-rail:px-0'
            : 'items-center',
        )}
      >
        <Link
          href="/"
          aria-label="Daisy Debate home"
          title="Daisy Debate"
          className={cn(
            'flex items-center no-underline hover:no-underline',
            extended
              ? 'h-nav-target w-full gap-2 px-2 text-md font-strong text-forest max-rail:w-nav-target max-rail:justify-center max-rail:gap-0 max-rail:px-0'
              : 'size-nav-target justify-center',
          )}
        >
          <DaisyLogo />
          <span className={extended ? 'max-rail:hidden' : 'hidden'}>
            Daisy Debate
          </span>
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
            'mt-auto flex list-none gap-1',
            extended
              ? 'w-full items-center border-t border-border pt-2 max-rail:flex-col max-rail:items-center'
              : 'flex-col items-center',
          )}
        >
          {extended ? (
            <>
              <AccountItem account={account} extended />
              {more}
            </>
          ) : (
            <>
              {more}
              <AccountItem account={account} extended={false} />
            </>
          )}
          <li className="max-rail:hidden">
            <form action={toggleRail}>
              <button
                type="submit"
                aria-label={extended ? 'Minimize' : 'Expand'}
                title={extended ? 'Minimize' : 'Expand'}
                className={navItemClass(false, false)}
              >
                <Icon
                  name={extended ? 'railMinimize' : 'railExpand'}
                  size={20}
                />
              </button>
            </form>
          </li>
        </ul>
      </nav>
    </div>
  );
}
