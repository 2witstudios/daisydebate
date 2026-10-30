import { NextLink, OnboardingFrame, StepFooter } from '../frame/frame';
import { heading, type IntroStepProps } from './intro';

/** The three formats with a rating ladder, Freestyle first. */
const ladders = [
  [
    'Freestyle',
    'Parli-style, on the spot.',
    'The topic is a surprise: five resolutions are drawn and you strike them in turn until one is left.',
    'Topic revealed at the table',
  ],
  [
    'Policy',
    '“Schools should ban smartphones during the school day.”',
    'Argue whether we should take an action.',
    'Topic known in advance',
  ],
  [
    'Value',
    '“Privacy ought to be valued above public safety.”',
    'Argue which value matters more.',
    'Topic known in advance',
  ],
] as const;

const pill =
  'shrink-0 rounded-round px-3 py-1 text-xs font-strong whitespace-nowrap';

export function StylesStep({ nextHref, backHref, skip }: IntroStepProps) {
  return (
    <OnboardingFrame step={2} titleId="onboarding-title" skip={skip}>
      <h1 id="onboarding-title" className={heading}>
        Ranked ladders and custom formats
      </h1>
      <p className="max-w-reading text-md leading-normal text-ink-muted">
        Freestyle, Policy and Value each have a ladder: win ranked rounds and
        your rating climbs. Every format runs the same round.
      </p>
      <div className="grid grid-cols-3 gap-4 max-narrow:grid-cols-1">
        {ladders.map(([name, quote, detail, tag]) => (
          <div
            key={name}
            className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-4"
          >
            <h2 className="font-display text-xl font-semibold text-ink">
              {name}
            </h2>
            <p className="font-display text-sm leading-normal text-ink-muted italic">
              {quote}
            </p>
            <p className="text-sm leading-normal text-ink-muted">{detail}</p>
            <p className="mt-auto text-sm font-strong text-ink">{tag}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-lg bg-surface-sunken px-5 py-3">
        <div className="flex min-w-0 flex-1 basis-onboarding-col flex-col gap-1">
          <h2 className="font-display text-xl font-semibold text-ink">
            Custom format
          </h2>
          <p className="text-sm leading-normal text-ink-muted">
            Want your own rules? Host a custom debate, or play other formats on
            the list. Practice or compete, just not ranked.
          </p>
        </div>
        <span className={`${pill} border border-border-strong text-ink`}>
          Unranked
        </span>
      </div>
      <StepFooter
        backHref={backHref}
        next={<NextLink href={nextHref}>Next</NextLink>}
      />
    </OnboardingFrame>
  );
}
