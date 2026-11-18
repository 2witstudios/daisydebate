import { NextLink, OnboardingFrame, StepFooter } from '../frame/frame';
import { stepNumber } from '../../../features/onboarding/steps';
import { DrawFigure } from './draw-figure';
import { NumberedSteps } from './intro-parts';
import { drawSize, preRoundPrepMinutes } from './freestyle';
import { heading, type IntroStepProps } from './intro';

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
        <NumberedSteps steps={steps} markerClass="bg-accent text-accent-ink" />
        <DrawFigure />
      </div>
      <StepFooter
        backHref={backHref}
        next={<NextLink href={nextHref}>Next</NextLink>}
      />
    </OnboardingFrame>
  );
}
