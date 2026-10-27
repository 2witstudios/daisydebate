/** The notice a page shows when it comes back from a failed sign-out. */
export const SIGN_OUT_FAILED_NOTICE =
  'We couldn’t sign you out. Please try again.';

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
    <form method="post" action="/auth/sign-out">
      <input type="hidden" name="next" value={next} />
      <button type="submit" className={className}>
        Sign out
      </button>
    </form>
  );
}
