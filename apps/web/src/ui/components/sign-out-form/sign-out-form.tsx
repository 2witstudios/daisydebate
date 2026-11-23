'use client';

import { Button } from '../button/button';
import type { ButtonVariant } from '../button/button-class';
import { clearAccountResumeRecords } from '../../../features/rooms/resume-departure';
import { clearAccountMediaPreferences } from '../../../features/round-media/account-signout-cleanup';

/**
 * The one sign-out control (ISSUE-691, review F9): a native form posting to
 * /auth/sign-out, so it works before hydration. `next` is this page, where
 * a failed sign-out returns with `?signOut=failed`; success lands on /sign-in.
 */
export function SignOutForm({
  next,
  variant,
  className,
}: {
  readonly next: string;
  /** The look of the place it sits: an action, a menu row, an onboarding target. */
  readonly variant: ButtonVariant;
  /** What the variant leaves to the place. */
  readonly className?: string;
}) {
  return (
    <form
      method="post"
      action="/auth/sign-out"
      onSubmit={() => {
        clearAccountMediaPreferences();
        clearAccountResumeRecords();
      }}
    >
      <input type="hidden" name="next" value={next} />
      <Button variant={variant} type="submit" className={className}>
        Sign out
      </Button>
    </form>
  );
}
