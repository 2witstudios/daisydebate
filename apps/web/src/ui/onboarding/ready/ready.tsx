import Link from 'next/link';
import { OnboardingFrame } from '../frame/frame';

export type ReadyStepProps = {
  /**
   * The validated destination after onboarding: the lobby for an approved
   * member. A still-pending account is sent on to the beta page by the
   * access gate (ADR 0075).
   */
  readonly homeHref: string;
};

const cta =
  'inline-flex min-h-onboarding-touch items-center justify-center rounded-round bg-accent px-8 text-md font-strong text-accent-ink no-underline hover:bg-accent-strong';

/** The last step: one simple send-off to the lobby. */
export function ReadyStep({ homeHref }: ReadyStepProps) {
  return (
    <OnboardingFrame step={null} titleId="onboarding-title">
      <div className="flex flex-col gap-4">
        <h1
          id="onboarding-title"
          tabIndex={-1}
          className="font-display text-3xl leading-tight font-semibold tracking-tight text-ink"
        >
          {`You're ready`}
        </h1>
        <p className="text-md text-ink-muted">
          Everything is set up. The lobby is where debates start. Jump in
          whenever you like.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        <Link href={homeHref} className={cta}>
          Enter the lobby
        </Link>
        <p className="text-base text-ink-muted">
          {`You're one of the first inside. More is landing every week.`}
        </p>
      </div>
    </OnboardingFrame>
  );
}
