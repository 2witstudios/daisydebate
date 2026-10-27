import Link from 'next/link';
import { OnboardingFrame } from '../onboarding/frame/frame';

export type BetaWaitingProps = {
  readonly username: string;
  /**
   * `pending` waits for approval; `revoked` access was paused;
   * `age-required` has no durable age record yet (the beta is 16+).
   */
  readonly reason: 'pending' | 'revoked' | 'age-required';
  /** The age step, which returns here once answered. */
  readonly ageHref: string;
  /** Signs out with a plain form post, so it works without JavaScript. */
  readonly signOutAction: () => Promise<void>;
};

const link =
  'inline-flex min-h-onboarding-touch items-center justify-center rounded-round border border-border px-6 text-md font-strong no-underline hover:no-underline';

/** A native form post: sign-out needs no JavaScript (ISSUE-691). */
function SignOut({ action }: { readonly action: () => Promise<void> }) {
  return (
    <form action={action}>
      <button type="submit" className={link}>
        Sign out
      </button>
    </form>
  );
}

/**
 * The beta waiting page (ADR 0075): an account that finished sign-up and
 * waits for an operator. Plain markup, so it works without JavaScript; the
 * account's own settings (sign-out, export, deletion) stay one link away.
 */
export function BetaWaiting({
  username,
  reason,
  ageHref,
  signOutAction,
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
        <div className="flex flex-wrap gap-3">
          <Link className={link} href={ageHref}>
            Add your age
          </Link>
          <Link className={link} href="/settings">
            Account settings
          </Link>
          <SignOut action={signOutAction} />
        </div>
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
      <div className="flex flex-wrap gap-3">
        <Link className={link} href="/leaderboard">
          See the leaderboard
        </Link>
        <Link className={link} href="/settings">
          Account settings
        </Link>
        <SignOut action={signOutAction} />
      </div>
    </OnboardingFrame>
  );
}
