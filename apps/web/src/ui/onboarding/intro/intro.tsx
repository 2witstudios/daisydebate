import type { ReactNode } from 'react';
import { cn } from '../../cn';
import { SampleAction } from '../../components/sample-action/sample-action';
import { SampleActionNotice } from '../../components/sample-action/sample-action-notice';
import { NextLink, OnboardingFrame, StepFooter } from '../frame/frame';

export type IntroStepProps = {
  readonly nextHref: string;
  readonly backHref: string | null;
  readonly skip: ReactNode;
};

export const heading =
  'font-display text-2xl leading-tight font-semibold tracking-tight text-ink';

/** Step 1: why debate. The one hero copy in the flow (ui-conventions.md). */
export function WhyStep({ nextHref, backHref, skip }: IntroStepProps) {
  const pillars = [
    ['Learn', 'Research the motion before you argue it.'],
    ['Reason', 'Build a case, then defend it under cross-examination.'],
    ['Communicate', 'Argue it out live with a real person.'],
  ] as const;
  return (
    <OnboardingFrame step={1} titleId="onboarding-title" skip={skip}>
      <div className="flex flex-col gap-8 rounded-lg bg-surface-stage p-10 text-stage-ink max-narrow:p-6">
        <h1
          id="onboarding-title"
          className="max-w-reading font-display text-display-sm leading-display font-semibold tracking-display text-balance max-narrow:text-2xl"
        >
          Debate is{' '}
          <span className="bg-yolk box-decoration-clone px-2 text-stage-accent-ink">
            self-defense
          </span>{' '}
          for free speech.
        </h1>
        <dl className="grid grid-cols-3 border-t-2 border-stage-ink max-narrow:grid-cols-1">
          {pillars.map(([title, line]) => (
            <div key={title} className="flex flex-col gap-2 pt-4 pr-5">
              <dt className="font-display text-2xl font-semibold text-yolk">
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

const draw = [
  { motion: 'Voting should be mandatory', struck: 'Aff' },
  { motion: 'Social media does more harm than good', struck: 'Neg' },
  { motion: 'This house would ban homework', struck: null },
  { motion: 'Cities should ban cars downtown', struck: 'Aff' },
  { motion: 'College should be free', struck: 'Neg' },
] as const;

/** Step 2: how Daisy works, from orientation to the ladder. */
export function DaisyStep({ nextHref, backHref, skip }: IntroStepProps) {
  const steps: ReadonlyArray<readonly [string, ReactNode]> = [
    [
      'Watch the orientation',
      <SampleAction
        key="orientation"
        label="Play the orientation"
        className="text-base font-strong text-accent underline underline-offset-4"
      >
        Play the orientation
      </SampleAction>,
    ],
    [
      'Join a debate',
      "Ranked or casual. You're matched with someone at your rating.",
    ],
    [
      'Prep the resolution',
      'Five are drawn at random. Each side strikes two, and you prep the one left.',
    ],
    [
      'Debate',
      'Live and on the clock, against a real person. A judge decides.',
    ],
    [
      'Climb the ladder',
      'Ranked wins raise your rating on the Daisy league leaderboard.',
    ],
  ];
  return (
    <OnboardingFrame step={2} titleId="onboarding-title" skip={skip}>
      <SampleActionNotice />
      <h1 id="onboarding-title" className={heading}>
        How Daisy works
      </h1>
      <div className="flex flex-wrap items-start gap-6">
        <ol className="flex min-w-0 flex-1 basis-onboarding-col flex-col gap-4">
          {steps.map(([title, detail], index) => (
            <li key={title} className="flex gap-4">
              <span
                className={cn(
                  marker,
                  index === 2
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
        <figure className="m-0 flex min-w-0 flex-1 basis-onboarding-col flex-col gap-2 rounded-lg bg-surface-sunken p-4">
          <figcaption className="flex justify-between text-xs font-strong tracking-widest text-ink-muted uppercase">
            <span>Resolution draw</span>
            <span className="tabular-nums">4 of 4 strikes</span>
          </figcaption>
          <ul className="flex flex-col gap-2">
            {draw.map(({ motion, struck }) =>
              struck === null ? (
                <li
                  key={motion}
                  className="flex items-center justify-between gap-3 rounded-md bg-accent px-3 py-3 text-accent-ink"
                >
                  <span className="font-display text-md">{motion}</span>
                  <span className="shrink-0 rounded-round bg-yolk px-2 py-1 text-xs font-strong text-stage-accent-ink">
                    Debating
                  </span>
                </li>
              ) : (
                <li
                  key={motion}
                  className="flex items-center justify-between gap-3 rounded-md bg-surface-raised px-3 py-2"
                >
                  <del className="text-base text-ink-muted">{motion}</del>
                  <span
                    className={cn(
                      'shrink-0 text-xs font-strong',
                      struck === 'Aff' ? 'text-accent' : 'text-hue-clay',
                    )}
                  >
                    {`${struck} struck`}
                  </span>
                </li>
              ),
            )}
          </ul>
        </figure>
      </div>
      <StepFooter
        backHref={backHref}
        next={<NextLink href={nextHref}>Next</NextLink>}
      />
    </OnboardingFrame>
  );
}
