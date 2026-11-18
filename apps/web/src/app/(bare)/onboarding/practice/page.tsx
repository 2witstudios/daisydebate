import type { Metadata } from 'next';
import type { SearchParams } from '../../../../features/access/decision';
import { PracticeStep } from '../../../../ui/onboarding/intro/practice-step';
import { stepSkip } from '../skip';
import { readStepEntry, stepRobots } from '../step-entry';
import { readStepLinks } from '../step-links';

export const metadata: Metadata = {
  title: 'Practise your league',
  robots: stepRobots,
};

export default async function OnboardingPracticeStepPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { destination } = await readStepEntry(searchParams, 'practice');
  const { nextHref, backHref } = await readStepLinks('practice', destination);
  return (
    <PracticeStep
      nextHref={nextHref}
      backHref={backHref}
      skip={stepSkip(destination)}
    />
  );
}
