import { NextLink, OnboardingFrame, StepFooter } from '../frame/frame';
import { stepNumber } from '../../../features/onboarding/steps';
import { heading, type IntroStepProps } from './intro';

/** Daisy's two choices: the ranked Freestyle standard, and Custom for any rules. */
const choices = [
  {
    name: 'Freestyle',
    tag: 'Ranked',
    summary: 'Daisy’s standard, with its own ladder.',
    detail: [
      'The topic is revealed at the table: five resolutions are drawn from Daisy’s bank, and the sides strike them in turn until one is left. Neg strikes first.',
      'Then 20 minutes of prep, and the round begins.',
    ],
  },
  {
    name: 'Custom',
    tag: 'Unranked',
    summary: 'Any rules, any kind of debate.',
    detail: [
      'Start from a league template such as NSDA Lincoln-Douglas, NCFCA Team Policy or Public Forum, or write your own.',
      'Practice or compete, just not ranked.',
    ],
  },
] as const;

const pill =
  'shrink-0 rounded-round px-3 py-1 text-xs font-strong whitespace-nowrap';

export function StylesStep({ nextHref, backHref, skip }: IntroStepProps) {
  return (
    <OnboardingFrame
      step={stepNumber('styles')}
      titleId="onboarding-title"
      skip={skip}
    >
      <h1 id="onboarding-title" className={heading}>
        Freestyle and Custom
      </h1>
      <p className="max-w-reading text-md leading-normal text-ink-muted">
        Play Freestyle to climb the ladder. Run anything else as a custom
        debate.
      </p>
      <div className="grid grid-cols-2 gap-4 max-narrow:grid-cols-1">
        {choices.map(({ name, tag, summary, detail }) => (
          <div
            key={name}
            className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-xl font-semibold text-ink">
                {name}
              </h2>
              <span
                className={
                  tag === 'Ranked'
                    ? `${pill} bg-accent text-accent-ink`
                    : `${pill} border border-border-strong text-ink`
                }
              >
                {tag}
              </span>
            </div>
            <p className="text-sm font-strong text-ink">{summary}</p>
            {detail.map((line) => (
              <p key={line} className="text-sm leading-normal text-ink-muted">
                {line}
              </p>
            ))}
          </div>
        ))}
      </div>
      <StepFooter
        backHref={backHref}
        next={<NextLink href={nextHref}>Next</NextLink>}
      />
    </OnboardingFrame>
  );
}
