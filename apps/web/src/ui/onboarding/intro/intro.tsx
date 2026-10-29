import type { ReactNode } from 'react';
import { LaddersFigure } from './ladders-figure';
import { cn } from '../../cn';
import { NextLink, OnboardingFrame, StepFooter } from '../frame/frame';

export type IntroStepProps = {
  readonly nextHref: string;
  readonly backHref: string | null;
  readonly skip: ReactNode;
};

export const heading =
  'font-display text-2xl leading-tight font-semibold tracking-tight text-ink';

const marker =
  'flex size-8 shrink-0 items-center justify-center rounded-round text-sm font-strong';

/** The opening slide introduces the product loop and its independent ladders. */
export function DaisyStep({ nextHref, backHref, skip }: IntroStepProps) {
  const steps: ReadonlyArray<readonly [string, ReactNode]> = [
    [
      'Lobby',
      'Choose ranked or casual and get matched with someone near your rating.',
    ],
    ['Debate', 'Go live, make your case, and let a judge decide.'],
    ['Ladder', 'Ranked results move your rating on that format’s ladder.'],
  ];
  return (
    <OnboardingFrame step={1} titleId="onboarding-title" skip={skip}>
      <h1 id="onboarding-title" className={heading}>
        How Daisy works
      </h1>
      <p className="max-w-reading text-md leading-normal text-ink-muted">
        Debate is a competitive sport. Now anyone can compete: no tournament, no
        travel, no weekend required.
      </p>
      <ol className="grid grid-cols-3 gap-6 max-narrow:grid-cols-1 max-narrow:gap-4">
        {steps.map(([title, detail], index) => (
          <li key={title} className="flex gap-3">
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
      <LaddersFigure />
      <StepFooter
        backHref={backHref}
        next={<NextLink href={nextHref}>Next</NextLink>}
      />
    </OnboardingFrame>
  );
}
