import type { ReactNode } from 'react';
import { cn } from '../../cn';
import { NextLink, OnboardingFrame, StepFooter } from '../frame/frame';

export type IntroStepProps = {
  readonly nextHref: string;
  readonly backHref: string | null;
  readonly skip: ReactNode;
};

export const heading =
  'font-display text-2xl leading-tight font-semibold tracking-tight text-ink';

/** Step 1: the pitch — competitive debate without the tournament. The one hero copy in the flow (ui-conventions.md). */
export function WhyStep({ nextHref, backHref, skip }: IntroStepProps) {
  const pillars = [
    ['Any time', 'A competitive round fits into an evening, not a weekend.'],
    ['Anyone', 'No club or bracket needed. Sign up and debate.'],
    [
      'Real',
      "Real opponents, real stakes: a judge's written verdict decides every round.",
    ],
  ] as const;
  return (
    <OnboardingFrame step={1} titleId="onboarding-title" skip={skip}>
      <div className="flex flex-col gap-8 rounded-lg border border-border bg-surface-raised p-10 text-ink shadow-1 max-narrow:p-6">
        <h1
          id="onboarding-title"
          className="max-w-reading font-display text-display-sm leading-display font-semibold tracking-display text-balance max-narrow:text-2xl"
        >
          {`You don't have to wait for a tournament to `}
          <span className="bg-yolk box-decoration-clone px-2 text-stage-accent-ink">
            compete
          </span>
          .
        </h1>
        <dl className="grid grid-cols-3 border-t-2 border-ink max-narrow:grid-cols-1">
          {pillars.map(([title, line]) => (
            <div key={title} className="flex flex-col gap-2 pt-4 pr-5">
              <dt className="font-display text-2xl font-semibold text-accent">
                {title}
              </dt>
              <dd className="text-md leading-normal">{line}</dd>
            </div>
          ))}
        </dl>
      </div>
      <StepFooter
        backHref={backHref}
        next={<NextLink href={nextHref}>Next</NextLink>}
      />
    </OnboardingFrame>
  );
}

const marker =
  'flex size-8 shrink-0 items-center justify-center rounded-round text-sm font-strong';

/** Step 2: how Daisy works, from joining to the ladders. Striking is left to each format's own primer (three ladders launch the beta). */
export function DaisyStep({ nextHref, backHref, skip }: IntroStepProps) {
  const steps: ReadonlyArray<readonly [string, ReactNode]> = [
    [
      'Join a debate',
      "Ranked or casual. You're matched with someone at your rating.",
    ],
    ['Debate', 'Live and on the clock, against a real person.'],
    [
      'Climb the ladders',
      'Ranked wins raise your rating. The beta starts with three ladders — one per format.',
    ],
  ];
  return (
    <OnboardingFrame step={2} titleId="onboarding-title" skip={skip}>
      <h1 id="onboarding-title" className={heading}>
        How Daisy works
      </h1>
      <ol className="flex flex-col gap-4">
        {steps.map(([title, detail], index) => (
          <li key={title} className="flex gap-4">
            <span
              className={cn(
                marker,
                index === 1
                  ? 'bg-yolk text-stage-accent-ink'
                  : 'bg-accent text-accent-ink',
              )}
            >
              {index + 1}
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-md font-strong text-ink">{title}</span>
              <span className="text-base leading-normal text-ink-muted">
                {detail}
              </span>
            </div>
          </li>
        ))}
      </ol>
      <StepFooter
        backHref={backHref}
        next={<NextLink href={nextHref}>Next</NextLink>}
      />
    </OnboardingFrame>
  );
}
