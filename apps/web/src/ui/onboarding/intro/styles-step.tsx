import { NextLink, OnboardingFrame, StepFooter } from '../frame/frame';
import { heading, type IntroStepProps } from './intro';

const formats = [
  [
    'Policy',
    '“Schools should ban smartphones during the school day.”',
    'Resolutions about what we should do, set ahead of time. Walk in with your case built.',
    'Resolution known in advance',
  ],
  [
    'Value',
    '“Privacy ought to be valued above public safety.”',
    'Resolutions about what we believe, set ahead of time, same as Policy.',
    'Resolution known in advance',
  ],
  [
    'Freestyle',
    'Parli-style, on the spot.',
    'Five resolutions are drawn at the table. Strike in turn until one is left, then 20 minutes to prep it. None during the round.',
    'Drawn and struck at the table',
  ],
] as const;

const struck = [
  ['National governments should adopt a universal basic income.', 'Neg'],
  ['The voting age in national elections should be lowered to sixteen.', 'Aff'],
  ['Social media has done more harm than good for teenagers.', 'Neg'],
  ['Standardized tests are a fair measure of student ability.', 'Aff'],
] as const;

export function StylesStep({ nextHref, backHref, skip }: IntroStepProps) {
  return (
    <OnboardingFrame step={2} titleId="onboarding-title" skip={skip}>
      <h1 id="onboarding-title" className={heading}>
        Three ways to debate
      </h1>
      <p className="max-w-reading text-md leading-normal text-ink-muted">
        All three run the same round: same speeches, same clock, same judges.
        What changes is how you get your resolution.
      </p>
      <div className="grid grid-cols-3 gap-4 max-narrow:grid-cols-1">
        {formats.map(([name, quote, detail, tag]) => (
          <div
            key={name}
            className="flex min-w-0 flex-col gap-3 rounded-lg border border-border p-5"
          >
            <h2 className="font-display text-xl font-semibold text-ink">
              {name}
            </h2>
            <p className="font-display text-base leading-normal text-ink-muted italic">
              {quote}
            </p>
            <p className="text-sm leading-normal text-ink-muted">{detail}</p>
            <p className="mt-auto text-sm font-strong text-ink">{tag}</p>
          </div>
        ))}
      </div>
      <figure className="rounded-lg bg-surface-sunken p-5">
        <figcaption className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs font-strong tracking-widest text-ink-muted uppercase">
            A Freestyle draw
          </span>
          <span className="text-xs font-strong text-ink">
            Neg strikes first · 20 minutes of prep after
          </span>
        </figcaption>
        <ol className="flex flex-col gap-2">
          {struck.map(([resolution, side]) => (
            <li
              key={resolution}
              className="flex flex-wrap items-center justify-between gap-3 rounded-sm bg-surface-raised px-4 py-2"
            >
              <del className="min-w-0 flex-1 text-sm text-ink-muted">
                {resolution}
              </del>
              <span
                className={`text-xs font-strong ${side === 'Neg' ? 'text-hue-clay' : 'text-accent'}`}
              >
                {side} struck
              </span>
            </li>
          ))}
          <li className="flex flex-wrap items-center justify-between gap-3 rounded-sm bg-accent px-4 py-3 text-accent-ink">
            <span className="min-w-0 flex-1 font-display text-base">
              Cities should make public transit free to ride.
            </span>
            <span className="rounded-round bg-yolk px-3 py-1 text-xs font-strong text-stage-accent-ink">
              You debate
            </span>
          </li>
        </ol>
      </figure>
      <StepFooter
        backHref={backHref}
        next={<NextLink href={nextHref}>Next</NextLink>}
      />
    </OnboardingFrame>
  );
}
