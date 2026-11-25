import { ShellLink as Link } from '../../shell-link';
import { Icon } from '../../../../components/icon/icon';
import { SignOutForm } from '../../../../components/sign-out-form/sign-out-form';
import { DismissibleDetails } from '../../../../components/dismissible-details/dismissible-details';
import {
  navFlyoutLinkClass,
  navItemClass,
} from '../../../../components/nav-item/nav-item-class';
import { cn } from '../../../../cn';
import type { ShellAccount } from '../../account';
import {
  legalLinks,
  moreDestination,
  morePagesFor,
  wayIn,
} from '../destinations';

/**
 * The rail's foot. Anyone who is not a member gets their way in first. Then
 * More, for everyone: the pages that are not destinations, Sign out for a
 * member, and the legal pages as one small line. Your own card, with your
 * status and profile, lives at the top of the people rail. More is a native
 * disclosure, so it opens on a tap before hydration, upward and to the right.
 */
export function MoreMenu({
  account,
  extended,
}: {
  readonly account: ShellAccount;
  readonly extended: boolean;
}) {
  const word = extended ? 'icon-rail:sr-only' : 'sr-only';
  return (
    <div className="flex w-full flex-col gap-1">
      {account.state === 'member' ? null : (
        <Link
          href={wayIn(account).href}
          title={wayIn(account).label}
          className={navItemClass(false, extended)}
        >
          <Icon name="person" size={20} />
          <span className={word}>{wayIn(account).label}</span>
        </Link>
      )}
      <DismissibleDetails
        className="relative w-full"
        summaryClassName={cn(
          navItemClass(false, extended),
          'cursor-pointer list-none',
        )}
        {...(extended ? {} : { summaryTitle: moreDestination.label })}
        summary={
          <>
            <Icon name={moreDestination.icon} size={20} />
            <span className={word}>{moreDestination.label}</span>
          </>
        }
      >
        <div className="absolute bottom-0 left-full z-30 ml-2 flex w-flyout flex-col gap-1 rounded-md border border-border bg-surface-raised p-2 shadow-3">
          <ul aria-label="More" className="flex list-none flex-col gap-1">
            {morePagesFor(account).map((link) => (
              <li key={link.href}>
                <Link href={link.href} className={navFlyoutLinkClass}>
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
          {account.state === 'member' ? (
            <>
              <hr className="mx-1 border-border" />
              <SignOutForm
                next="/"
                look={{ variant: 'flyout-item' }}
                className="w-full"
              />
            </>
          ) : null}
          <LegalLine />
        </div>
      </DismissibleDetails>
    </div>
  );
}

/** Terms · Privacy, small, at the bottom of More: the rail's menu or the phone's sheet. */
export function LegalLine({ sheet = false }: { readonly sheet?: boolean }) {
  return (
    <ul
      aria-label="Legal"
      className={cn(
        'flex list-none gap-2 pt-1 text-ink-muted',
        sheet ? 'px-6 pb-3 text-sm' : 'px-3 text-xs',
      )}
    >
      {legalLinks.map((link, index) => (
        <li key={link.href} className="flex gap-2">
          {index > 0 ? <span aria-hidden="true">·</span> : null}
          <Link href={link.href} className="text-ink-muted">
            {link.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}
