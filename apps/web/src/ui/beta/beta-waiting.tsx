import Link from 'next/link';
import { destinationHref } from '../../features/coming-soon/launch';
import { cn } from '../cn';
import { OnboardingFrame } from '../onboarding/frame/frame';
import { SignOutForm } from '../components/sign-out-form/sign-out-form';
import { SIGN_OUT_FAILED_NOTICE } from '../components/sign-out-form/sign-out-notice';

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

const marker =
  'flex size-8 shrink-0 items-center justify-center rounded-round text-sm font-strong';

/** Where a waiting account stands: set up, waiting, then in. */
const progress = [
  ['Account ready', 'Your username is claimed.', 'Done'],
  ['Waiting for approval', 'Nothing to do. Your place is saved.', 'Now'],
  ['You are in', 'We email you, then the lobby is yours.', 'Next'],
] as const;

const whileYouWait = [
  ['Watch a debate', 'See how a round plays out.', destinationHref('watch')],
  [
    'See the leaderboard',
    'Look at the ladders you will climb.',
    destinationHref('leaderboard'),
  ],
] as const;

/** The pending account's status: a three-step line and things to do meanwhile. */
function WaitingStatus() {
  return (
    <>
      <ol className="grid grid-cols-3 gap-4 rounded-lg bg-surface-sunken px-5 py-4 max-narrow:grid-cols-1">
        {progress.map(([title, detail, state], index) => (
          <li key={title} className="flex gap-3">
            <span
              className={cn(
                marker,
                index === 0 && 'bg-accent text-accent-ink',
                index === 1 && 'bg-yolk text-stage-accent-ink',
                index === 2 && 'border border-border-strong text-ink-muted',
              )}
            >
              {index + 1}
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-md font-strong text-ink">{title}</span>
              <span className="text-sm leading-normal text-ink-muted">
                {detail}
              </span>
              <span className="text-xs font-strong tracking-widest text-ink-muted uppercase">
                {state}
              </span>
            </div>
          </li>
        ))}
      </ol>
      <div className="flex flex-col gap-2">
        <h2 className="text-xs font-strong tracking-widest text-ink-muted uppercase">
          While you wait
        </h2>
        <div className="grid grid-cols-2 gap-3 max-narrow:grid-cols-1">
          {whileYouWait.map(([title, detail, href]) => (
            <Link
              key={title}
              href={href}
              className="flex flex-col gap-1 rounded-lg border border-border px-4 py-3 no-underline hover:bg-surface-sunken hover:no-underline"
            >
              <span className="text-md font-strong text-ink">{title}</span>
              <span className="text-sm text-ink-muted">{detail}</span>
            </Link>
          ))}
        </div>
      </div>
    </>
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
      <div className="flex flex-col gap-3">
        <h1
          id="beta-waiting-title"
          className="font-display text-3xl font-semibold text-ink"
        >
          {paused
            ? 'Your beta access is paused'
            : `You're on the list, @${username}`}
        </h1>
        <p className="max-w-reading text-md text-ink-muted">
          {paused
            ? 'Your account is safe, but it cannot join debates right now. We will email you if that changes.'
            : 'Daisy is in a private beta. Your account is set up, and we will email you as soon as you are in.'}
        </p>
      </div>
      {paused ? (
        <Link className={`${link} self-start`} href="/leaderboard">
          See the leaderboard
        </Link>
      ) : (
        <WaitingStatus />
      )}
      <div className="mt-auto border-t border-border pt-4">
        <Actions failed={signOutFailed}>{null}</Actions>
      </div>
    </OnboardingFrame>
  );
}
