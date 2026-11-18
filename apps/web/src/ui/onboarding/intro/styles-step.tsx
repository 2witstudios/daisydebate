import { NextLink, OnboardingFrame, StepFooter } from '../frame/frame';
import { stepNumber } from '../../../features/onboarding/steps';
import { DrawFigure } from './draw-figure';
import { drawSize, preRoundPrepMinutes } from './freestyle';
import { heading, type IntroStepProps } from './intro';

const marker =
  'flex size-8 shrink-0 items-center justify-center rounded-round bg-accent text-sm font-strong text-accent-ink';

/** Step 2: Freestyle, and how its resolution is chosen at the table. */
export function StylesStep({ nextHref, backHref, skip }: IntroStepProps) {
  const steps = [
    [
      `${drawSize} resolutions are drawn`,
      'Daisy draws them at random from its bank when the round starts.',
    ],
    [
      'The sides strike in turn',
      'Neg strikes first, then Aff, until one resolution is left. That’s the one you debate.',
    ],
    [
      `${preRoundPrepMinutes} minutes of prep, then go live`,
      'Ranked results move your rating on the season’s ladder.',
    ],
  ] as const;
  return (
    <OnboardingFrame
      step={stepNumber('styles')}
      titleId="onboarding-title"
      skip={skip}
    >
      <h1 id="onboarding-title" className={heading}>
        Freestyle, Daisy’s standard
      </h1>
      <p className="max-w-reading text-md leading-normal text-ink-muted">
        The ranked format, built on American parliamentary debate. Nobody preps
        a case in advance: the resolution is chosen at the table.
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
        <DrawFigure />
      </div>
      <StepFooter
        backHref={backHref}
        next={<NextLink href={nextHref}>Next</NextLink>}
      />
    </OnboardingFrame>
  );
}
