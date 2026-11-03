import { OnboardingFrame } from '../onboarding/frame/frame';
import { AccountExit } from '../onboarding/account-exit/account-exit';

/**
 * Where a suspended or banned account lands (ADR 0103). Plain markup, so it
 * works without JavaScript; export and deletion stay one link away.
 */
export function RestrictedAccount({
  username,
  until,
  signOutFailed,
}: {
  readonly username: string;
  /** When a suspension ends; null for a ban. */
  readonly until: string | null;
  readonly signOutFailed: boolean;
}) {
  return (
    <OnboardingFrame step={null} titleId="restricted-title">
      <div className="flex flex-col gap-4">
        <h1
          id="restricted-title"
          className="font-display text-3xl font-semibold text-ink"
        >
          Your account is restricted, @{username}
        </h1>
        <p className="text-md text-ink-muted">
          A moderator restricted this account after a report
          {until ? ` until ${until.slice(0, 10)}` : ''}. You can sign out or
          manage your data in account settings.
        </p>
      </div>
      <AccountExit failed={signOutFailed} returnTo="/restricted">
        {null}
      </AccountExit>
    </OnboardingFrame>
  );
}
