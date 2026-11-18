import Link from 'next/link';
import { NextLink, OnboardingFrame, StepFooter } from '../frame/frame';
import { stepNumber } from '../../../features/onboarding/steps';
import { heading, hostTag, type HostAwareStepProps } from './intro';
import { IntroCard } from './intro-parts';

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
 * Step 5: Daisy Tab for leagues and hosts, tagged by whether Tab is released
 * to the viewer. Its link is the public Tournaments page, which says what is
 * open to them: Tab has no host landing page yet (`/host` answers missing).
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
        {tools.map((tool) => (
          <IntroCard key={tool.name} {...tool} />
        ))}
      </ul>
      <Link href="/tournaments" className="self-start text-base font-strong">
        Tournaments on Daisy
      </Link>
      <StepFooter
        backHref={backHref}
        next={<NextLink href={nextHref}>Next</NextLink>}
      />
    </OnboardingFrame>
  );
}
