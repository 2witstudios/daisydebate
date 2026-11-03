import Link from 'next/link';
import { SignOutForm } from '../../components/sign-out-form/sign-out-form';
import { SIGN_OUT_FAILED_NOTICE } from '../../components/sign-out-form/sign-out-notice';

export const accountExitLink =
  'inline-flex min-h-onboarding-touch items-center justify-center rounded-round border border-border px-6 text-md font-strong no-underline hover:no-underline';

/**
 * The account's way out (ISSUE-691, plan BETA §5): a native form, so it
 * signs out without JavaScript, beside the page's links.
 */
export function AccountExit({
  failed,
  children,
}: {
  readonly failed: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      {failed ? (
        <p role="alert" className="text-md text-ink">
          {SIGN_OUT_FAILED_NOTICE}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        {children}
        <Link className={accountExitLink} href="/settings">
          Account settings
        </Link>
        <SignOutForm
          next="/beta"
          className={`${accountExitLink} bg-transparent`}
        />
      </div>
    </div>
  );
}
