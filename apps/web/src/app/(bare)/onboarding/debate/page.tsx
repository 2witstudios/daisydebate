import type { Metadata } from 'next';
import type { SearchParams } from '../../../../features/access/decision';
import { DebateStep } from '../../../../ui/onboarding/intro/debate-step';
import { stepSkip } from '../skip';
import { readStepEntry, stepRobots } from '../step-entry';
import { readStepLinks } from '../step-links';

export const metadata: Metadata = {
  title: 'How a debate works',
  robots: stepRobots,
};

export default async function OnboardingDebateStepPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { destination } = await readStepEntry(searchParams, 'debate');
  const { nextHref, backHref } = await readStepLinks('debate', destination);
  return (
    <DebateStep
      nextHref={nextHref}
      backHref={backHref}
      skip={stepSkip(destination)}
    />
  );
}
