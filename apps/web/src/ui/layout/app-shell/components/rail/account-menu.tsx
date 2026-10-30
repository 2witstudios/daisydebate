import Link from 'next/link';
import { Suspense } from 'react';
import { Avatar } from '../../../../components/avatar/avatar';
import { Icon } from '../../../../components/icon/icon';
import { SignOutForm } from '../../../../components/sign-out-form/sign-out-form';
import {
  navFlyoutLinkClass,
  navItemClass,
} from '../../../../components/nav-item/nav-item-class';
import { viewerStatus } from '../../../../friends/friends';
import { cn } from '../../../../cn';
import type { ShellAccount, ShellRatings } from '../../account';
import { profileHref, wayIn } from '../destinations';
import { AccountRatings, RatingsSkeleton } from './account-ratings';
import { DismissibleDetails } from './dismissible-details';

/**
 * The foot's account control. A member's avatar, with the username beside it
 * when extended, opens a menu upward and to the right: their ratings, then the
 * account pages and sign-out. The menu is a native disclosure, so it opens on
 * a tap without script. A visitor gets the way in on the same row.
 */
export function AccountMenu({
  account,
  extended,
  ratings,
}: {
  readonly account: ShellAccount;
  readonly extended: boolean;
  /** Null when the viewer is not a member, so there is nothing to read. */
  readonly ratings: Promise<ShellRatings> | null;
}) {
  if (account.state !== 'member') {
    const { href, label } = wayIn(account);
    return (
      <Link href={href} title={label} className={navItemClass(false, extended)}>
        <Icon name="person" size={20} />
        <span className={extended ? 'max-rail:sr-only' : 'sr-only'}>
          {label}
        </span>
      </Link>
    );
  }
  const { username } = account;
  return (
    <DismissibleDetails
      className="relative w-full"
      summaryClassName={cn(navItemClass(false, extended), 'list-none')}
      summaryAriaLabel={`Your account, ${username}`}
      summaryTitle="Account"
      summary={
        <>
          <Avatar name={username} presence={viewerStatus} size="sm" />
          {extended ? (
            <span
              aria-hidden="true"
              className="min-w-0 flex-1 truncate text-sm font-semibold text-ink max-rail:hidden"
            >
              {username}
            </span>
          ) : null}
        </>
      }
    >
      <div className="absolute bottom-0 left-full z-30 ml-2 flex w-flyout flex-col gap-1 rounded-md border border-border bg-surface-raised p-2 shadow-3">
        <div className="flex items-center gap-3 p-2">
          <Avatar name={username} size="md" />
          <span className="min-w-0 truncate text-sm font-semibold text-ink">
            {username}
          </span>
        </div>
        <div className="rounded-sm bg-background p-2">
          {ratings ? (
            <Suspense fallback={<RatingsSkeleton />}>
              <AccountRatings ratings={ratings} />
            </Suspense>
          ) : null}
        </div>
        <Link href={profileHref(username)} className={navFlyoutLinkClass}>
          Profile
        </Link>
        <Link href="/settings" className={navFlyoutLinkClass}>
          Settings
        </Link>
        <Link href="/help" className={navFlyoutLinkClass}>
          Help
        </Link>
        <Link href="/terms" className={navFlyoutLinkClass}>
          Terms
        </Link>
        <Link href="/privacy" className={navFlyoutLinkClass}>
          Privacy
        </Link>
        <SignOutForm
          next="/"
          className={cn(navFlyoutLinkClass, 'w-full text-left')}
        />
      </div>
    </DismissibleDetails>
  );
}
