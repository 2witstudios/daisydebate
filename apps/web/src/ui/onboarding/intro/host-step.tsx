import Link from 'next/link';
import { hostRoutes } from '../../../features/tab/routes';
import { NextLink, OnboardingFrame, StepFooter } from '../frame/frame';
import { stepNumber } from '../../../features/onboarding/steps';
import { heading, hostTag, type HostAwareStepProps } from './intro';

const tools = [
  {
    name: 'Your league',
    summary: 'A home for your members, with its own place to play.',
    points: [
      'Its own lobby for matches between members',
      'Its own ladder and seasons',
      'Members, coaches and judges in one place',
    ],
  },
  {
    name: 'Your tournaments',
    summary:
      'Tabulation built in, from setup to the final standings. Run it online, or in person at your venue.',
    points: [
      'Events, entries and judges',
      'Pairings, rounds and ballots',
      'Results and standings',
    ],
  },
] as const;

/**
 * Step 5: Daisy Tab for leagues and hosts. Until Tab is released to the
 * viewer its link leads to the Tournaments page, never to a route that
 * would answer as missing.
 */
export function HostStep({
  nextHref,
  backHref,
  skip,
  tabReleased,
}: HostAwareStepProps) {
  const tag = hostTag(tabReleased);
  return (
    <OnboardingFrame
      step={stepNumber('host')}
      titleId="onboarding-title"
      skip={skip}
    >
      <div className="flex flex-wrap items-center gap-3">
        <h1 id="onboarding-title" className={heading}>
          Run your league
        </h1>
        <span className={tag.className}>{tag.label}</span>
      </div>
      <p className="max-w-reading text-md leading-normal text-ink-muted">
        Coach a club, run a league or host a tournament? Bring it to Daisy,
        where your debaters already are.
      </p>
      <ul className="grid grid-cols-2 gap-4 max-narrow:grid-cols-1">
        {tools.map(({ name, summary, points }) => (
          <li
            key={name}
            className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-4"
          >
            <h2 className="font-display text-xl font-semibold text-ink">
              {name}
            </h2>
            <p className="text-sm leading-normal text-ink-muted">{summary}</p>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm leading-normal text-ink">
              {points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <Link
        href={tabReleased ? hostRoutes.home : '/tournaments'}
        className="self-start text-base font-strong"
      >
        {tabReleased
          ? 'Set up a league or tournament'
          : 'See what’s coming for tournaments'}
      </Link>
      <StepFooter
        backHref={backHref}
        next={<NextLink href={nextHref}>Next</NextLink>}
      />
    </OnboardingFrame>
  );
}
