import { Announcement } from '../../components/announcement/announcement';
import Link from 'next/link';
import { buttonClass } from '../../components/button/button-class';
import { SignOutForm } from '../../components/sign-out-form/sign-out-form';
import { SIGN_OUT_FAILED_NOTICE } from '../../components/sign-out-form/sign-out-notice';

export const accountExitLink = buttonClass('touch-secondary');

/**
 * The account's way out (ISSUE-691, plan BETA §5): a native form, so it
 * signs out before hydration, beside the page's links.
 */
export function AccountExit({
  failed,
  returnTo,
  children,
}: {
  readonly failed: boolean;
  /** The page a failed sign-out comes back to, with its notice. */
  readonly returnTo: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      {failed ? (
        <Announcement as="p" kind="problem" className="text-md text-ink">
          {SIGN_OUT_FAILED_NOTICE}
        </Announcement>
      ) : null}
      <div className="flex flex-wrap gap-3">
        {children}
        <Link className={accountExitLink} href="/settings">
          Account settings
        </Link>
        <SignOutForm next={returnTo} look={{ variant: 'touch-secondary' }} />
      </div>
    </div>
  );
}
