import Link from 'next/link';
import { DaisyLogo } from '../../../../components/daisy-mark/daisy-mark';
import { Icon } from '../../../../components/icon/icon';
import { NavItem } from '../../../../components/nav-item/nav-item';
import { navItemClass } from '../../../../components/nav-item/nav-item-class';
import { cn } from '../../../../cn';
import type { RailPreference } from '../../rail-preference';
import type { ShellAccount, ShellRatings } from '../../account';
import {
  memberDestinations,
  notificationsDestination,
  primaryDestinations,
} from '../destinations';
import { AccountMenu } from './account-menu';
import { FriendsLink } from './friends-link';

/** A member's own places: their inbox, notifications (once launched) and friends. */
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
 * The rail's collapse control, a row like the links above it: Minimize when
 * extended, Expand when mini. It posts the saved choice, and it is hidden
 * below the rail breakpoint, where the rail is icon-only whatever is saved.
 */
function ToggleItem({
  extended,
  toggleRail,
}: {
  readonly extended: boolean;
  readonly toggleRail: () => Promise<void>;
}) {
  const name = extended ? 'Minimize' : 'Expand';
  return (
    <li className="max-rail:hidden">
      <form action={toggleRail}>
        <button
          type="submit"
          title={extended ? undefined : name}
          className={navItemClass(false, extended)}
        >
          <Icon name={extended ? 'railMinimize' : 'railExpand'} size={20} />
          <span className={extended ? 'max-rail:sr-only' : 'sr-only'}>
            {name}
          </span>
        </button>
      </form>
    </li>
  );
}

export type RailProps = {
  readonly account: ShellAccount;
  /** The viewer's saved rail width, resolved per request (ADR 0091). */
  readonly rail: RailPreference;
  /** A member's ratings for the account menu; null for anyone else. */
  readonly ratings: Promise<ShellRatings> | null;
  /** The server action the toggle form posts; it flips the saved choice. */
  readonly toggleRail: () => Promise<void>;
};

/**
 * The one navigation rail on every shell page, beside the page. Top to
 * bottom: the logo (with the Daisy Debate wordmark when extended), the
 * launched destinations, a divider, a member's messages, notifications (once
 * launched) and friends with Minimize as the last row of that group, then
 * the account at the foot. The account opens a menu with the member's
 * ratings and the account pages; More is that menu now. Extended (the
 * default) each name shows beside its icon; mini is icons only, with names
 * as screen-reader text and tooltips. Below the rail breakpoint CSS alone
 * keeps every name intact and hides the wordmark, the username and Minimize
 * (ADR 0091). Badges and the flyout on Watch are the same in both modes; the
 * account menu opens sideways, so it never needs the foot's space. The rail
 * sticks to the viewport at every height, so it never scrolls with the page.
 * Gives way to the tab bar on a phone.
 */
export function Rail({ account, rail, ratings, toggleRail }: RailProps) {
  const extended = rail === 'extended';
  const group = cn(
    'flex list-none flex-col gap-1',
    extended && 'w-full items-stretch max-rail:items-center',
  );
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
          className={cn(
            'flex items-center no-underline hover:no-underline',
            extended
              ? 'h-nav-target w-full gap-2 px-2 text-md font-strong text-ink max-rail:w-nav-target max-rail:justify-center max-rail:gap-0 max-rail:px-0'
              : 'size-nav-target justify-center',
          )}
        >
          <DaisyLogo />
          <span className={extended ? 'max-rail:hidden' : 'hidden'}>
            Daisy Debate
          </span>
        </Link>
        <ul className={group}>
          {primaryDestinations.map((item) => (
            <li key={item.label}>
              <NavItem {...item} extended={extended} />
            </li>
          ))}
        </ul>
        <hr
          className={cn(
            'my-1 border-border',
            extended
              ? 'mx-2 max-rail:mx-auto max-rail:w-nav-target'
              : 'w-nav-target',
          )}
        />
        <ul className={group}>
          <MemberPlaces account={account} extended={extended} />
          <ToggleItem extended={extended} toggleRail={toggleRail} />
        </ul>
        <div className={cn('mt-auto', extended && 'w-full')}>
          <AccountMenu
            account={account}
            extended={extended}
            ratings={ratings}
          />
        </div>
      </nav>
    </div>
  );
}
