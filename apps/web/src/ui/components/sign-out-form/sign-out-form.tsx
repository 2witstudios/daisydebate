'use client';

import { clearAccountMediaPreferences } from '../../../features/round-media/account-signout-cleanup';

/**
 * The one sign-out control (ISSUE-691, review F9): a native form posting to
 * /auth/sign-out, so it works without JavaScript. `next` is this page, where
 * a failed sign-out returns with `?signOut=failed`; success lands on /sign-in.
 */
export function SignOutForm({
  next,
  className,
}: {
  readonly next: string;
  readonly className: string;
}) {
  return (
    <form
      method="post"
      action="/auth/sign-out"
      onSubmit={() => clearAccountMediaPreferences()}
    >
      <input type="hidden" name="next" value={next} />
      <button type="submit" className={className}>
        Sign out
      </button>
    </form>
  );
}
