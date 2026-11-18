import { NextLink, OnboardingFrame, StepFooter } from '../frame/frame';
import { stepNumber } from '../../../features/onboarding/steps';
import { catalogTemplates } from './templates';
import { heading, pill, type IntroStepProps } from './intro';

const marker =
  'flex size-8 shrink-0 items-center justify-center rounded-round bg-hue-teal text-sm font-strong text-surface-raised';

const steps = [
  [
    'Pick your format',
    'Start from a league template, or set your own speeches, timings and prep.',
  ],
  [
    'Bring your people',
    'Invite teammates, opponents and a judge to the room. Team formats work too.',
  ],
  [
    'Debate, then read the ballot',
    'The judge scores each side and writes why. No judge free? Add an AI judge, premium on casual rounds.',
  ],
] as const;

/** Step 4: practising any format, the custom side of Daisy. */
export function PracticeStep({ nextHref, backHref, skip }: IntroStepProps) {
  return (
    <OnboardingFrame
      step={stepNumber('practice')}
      titleId="onboarding-title"
      skip={skip}
    >
      <div className="flex flex-wrap items-center gap-3">
        <h1 id="onboarding-title" className={heading}>
          Practise your league
        </h1>
        <span className={`${pill} bg-hue-teal-soft text-hue-teal`}>
          Unranked
        </span>
      </div>
      <p className="max-w-reading text-md leading-normal text-ink-muted">
        Run practice rounds in the format you compete in, with your team or
        anyone else, any night of the week.
      </p>
      <div className="grid grid-cols-2 items-start gap-6 max-narrow:grid-cols-1">
        <ol className="flex flex-col gap-4">
          {steps.map(([title, detail], index) => (
            <li key={title} className="flex gap-3">
              <span className={marker}>{index + 1}</span>
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-md font-strong text-ink">{title}</span>
                <span className="text-base leading-normal text-ink-muted">
                  {detail}
                </span>
              </div>
            </li>
          ))}
        </ol>
        <section
          aria-labelledby="templates"
          className="flex flex-col gap-3 rounded-lg bg-surface-sunken p-4"
        >
          <h2
            id="templates"
            className="text-xs font-strong tracking-widest text-ink-muted uppercase"
          >
            Templates
          </h2>
          <ul className="flex flex-wrap gap-2">
            {catalogTemplates.map((name) => (
              <li
                key={name}
                className="rounded-round bg-surface-raised px-3 py-1 text-sm text-ink"
              >
                {name}
              </li>
            ))}
            <li className="rounded-round border border-dashed border-border-strong px-3 py-1 text-sm text-ink">
              Your own rules
            </li>
          </ul>
        </section>
      </div>
      <StepFooter
        backHref={backHref}
        next={<NextLink href={nextHref}>Next</NextLink>}
      />
    </OnboardingFrame>
  );
}
