import Link from 'next/link';
import { OnboardingFrame } from '../onboarding/frame/frame';
import {
  SIGN_OUT_FAILED_NOTICE,
  SignOutForm,
} from '../components/sign-out-form/sign-out-form';

export type BetaWaitingProps = {
  readonly username: string;
  /**
   * `pending` waits for approval; `revoked` access was paused;
   * `age-required` has no durable age record yet (the beta is 16+).
   */
  readonly reason: 'pending' | 'revoked' | 'age-required';
  /** The age step, which returns here once answered. */
  readonly ageHref: string;
  /** Back from a sign-out that did not happen (ISSUE-691). */
  readonly signOutFailed?: boolean;
};

const link =
  'inline-flex min-h-onboarding-touch items-center justify-center rounded-round border border-border px-6 text-md font-strong no-underline hover:no-underline';

/**
 * The account's way out (ISSUE-691, plan BETA §5): a native form, so it
 * signs out without JavaScript, beside the page's links.
 */
function Actions({
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
        <Link className={link} href="/settings">
          Account settings
        </Link>
        <SignOutForm next="/beta" className={`${link} bg-transparent`} />
      </div>
    </div>
  );
}

/**
 * The beta waiting page (ADR 0075): an account that finished sign-up and
 * waits for an operator. Plain markup, so it works without JavaScript: it
 * signs out in place, and the account's settings (export, deletion) stay one
 * link away.
 */
export function BetaWaiting({
  username,
  reason,
  ageHref,
  signOutFailed = false,
}: BetaWaitingProps) {
  const paused = reason === 'revoked';
  if (reason === 'age-required')
    return (
      <OnboardingFrame step={null} titleId="beta-waiting-title">
        <div className="flex flex-col gap-4">
          <h1
            id="beta-waiting-title"
            className="font-display text-3xl font-semibold text-ink"
          >
            One more step, @{username}
          </h1>
          <p className="text-md text-ink-muted">
            The Daisy beta is open to people 16 and older. Tell us your birth
            month and year to continue.
          </p>
        </div>
        <Actions failed={signOutFailed}>
          <Link className={link} href={ageHref}>
            Add your age
          </Link>
        </Actions>
      </OnboardingFrame>
    );
  return (
    <OnboardingFrame step={null} titleId="beta-waiting-title">
      <div className="flex flex-col gap-4">
        <h1
          id="beta-waiting-title"
          className="font-display text-3xl font-semibold text-ink"
        >
          {paused
            ? 'Your beta access is paused'
            : `You're on the list, @${username}`}
        </h1>
        <p className="text-md text-ink-muted">
          {paused
            ? 'Your account is safe, but it cannot join debates right now. We will email you if that changes.'
            : 'Daisy is in a private beta. Your account is set up, and we will email you as soon as you are in.'}
        </p>
      </div>
      <Actions failed={signOutFailed}>
        <Link className={link} href="/leaderboard">
          See the leaderboard
        </Link>
      </Actions>
    </OnboardingFrame>
  );
}
