import Link from 'next/link';
import { OnboardingFrame } from '../frame/frame';

export type ReadyStepProps = {
  /**
   * The validated destination after onboarding: the lobby for an approved
   * member. The page sends a still-pending account to the beta page first
   * (ADR 0075), so this step only renders for a member.
   */
  readonly homeHref: string;
};

const cta =
  'inline-flex min-h-onboarding-touch items-center justify-center rounded-round bg-accent px-8 text-md font-strong text-accent-ink no-underline hover:bg-accent-strong';

/** The last step: one simple send-off to the lobby. */
export function ReadyStep({ homeHref }: ReadyStepProps) {
  return (
    <OnboardingFrame step={null} titleId="onboarding-title">
      <div className="flex flex-1 flex-col items-center justify-center gap-4 py-6 text-center">
        <h1
          id="onboarding-title"
          tabIndex={-1}
          className="font-display text-3xl leading-tight font-semibold tracking-tight text-ink"
        >
          {`You're ready`}
        </h1>
        <p className="max-w-reading text-md text-ink-muted">
          Everything is set up. The lobby is where debates start. Jump in
          whenever you like.
        </p>

        <Link href={homeHref} className={`${cta} mt-2`}>
          Enter the lobby
        </Link>
        <p className="text-base text-ink-muted">
          {`You're one of the first inside. More is landing every week.`}
        </p>
      </div>
    </OnboardingFrame>
  );
}
