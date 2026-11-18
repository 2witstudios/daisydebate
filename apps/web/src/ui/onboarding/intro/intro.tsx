import type { ReactNode } from 'react';
import { NextLink, OnboardingFrame, StepFooter } from '../frame/frame';
import { stepNumber } from '../../../features/onboarding/steps';
import { freestyleLine } from './freestyle';
import { IntroCard } from './intro-parts';

export type IntroStepProps = {
  readonly nextHref: string;
  readonly backHref: string | null;
  readonly skip: ReactNode;
};

/** A step that points at Daisy Tab, which shows only once it is released. */
export type HostAwareStepProps = IntroStepProps & {
  /** Whether Daisy Tab's hosting tools are released to this viewer. */
  readonly tabReleased: boolean;
};

export const heading =
  'font-display text-2xl leading-tight font-semibold tracking-tight text-ink';

export const pill =
  'shrink-0 rounded-round px-3 py-1 text-xs font-strong whitespace-nowrap';

/** The tag a host-facing card carries: who it is for, or that it is early. */
export const hostTag = (tabReleased: boolean) =>
  tabReleased
    ? {
        label: 'For leagues and hosts',
        className: `${pill} bg-gold-soft text-gold`,
      }
    : {
        label: 'Early access',
        className: `${pill} border border-border-strong text-ink-muted`,
      };

type Way = {
  readonly name: string;
  readonly tag: { readonly label: string; readonly className: string };
  readonly summary: string;
  readonly points: readonly string[];
};

/**
 * The opening slide: the three ways to use Daisy, each taught on a slide of
 * its own after this one (Freestyle's draw and round, practice, hosting).
 */
export function DaisyStep({
  nextHref,
  backHref,
  skip,
  tabReleased,
}: HostAwareStepProps) {
  const ways: readonly Way[] = [
    {
      name: 'Compete',
      tag: { label: 'Ranked', className: `${pill} bg-accent text-accent-ink` },
      summary:
        'Play Freestyle, Daisy’s standard. Get matched with someone near your rating, and every result moves you on the season’s ladder.',
      points: [
        `${freestyleLine.replace(' · ', ', ')} with prep`,
        'Resolution chosen at the table',
        'One ladder per season',
      ],
    },
    {
      name: 'Practise your league',
      tag: {
        label: 'Unranked',
        className: `${pill} bg-hue-teal-soft text-hue-teal`,
      },
      summary:
        'Run any kind of round with your team or club. Start from a league template, or write your own rules.',
      points: [
        'IPDA, Lincoln-Douglas, Public Forum, Policy and more',
        'Invite a judge, or add an AI judge (premium)',
        'Read the judge’s ballot afterwards',
      ],
    },
    {
      name: 'Run your league',
      tag: hostTag(tabReleased),
      summary:
        'Give your league its own lobby and ladder, and host tournaments with tabulation built in.',
      points: [
        'Pairings, judges and ballots',
        'Standings and results',
        'Online or in person',
      ],
    },
  ];
  return (
    <OnboardingFrame
      step={stepNumber('daisy')}
      titleId="onboarding-title"
      skip={skip}
    >
      <h1 id="onboarding-title" className={heading}>
        How Daisy works
      </h1>
      <p className="max-w-reading text-md leading-normal text-ink-muted">
        Debate is a competitive sport, and Daisy is where it’s played, any time.
        Climb the ladder, practise your league’s format, or run your whole
        league here.
      </p>
      <ul className="grid grid-cols-3 gap-4 max-tiles:grid-cols-1">
        {ways.map((way) => (
          <IntroCard key={way.name} {...way} />
        ))}
      </ul>
      <StepFooter
        backHref={backHref}
        next={<NextLink href={nextHref}>Next</NextLink>}
      />
    </OnboardingFrame>
  );
}
