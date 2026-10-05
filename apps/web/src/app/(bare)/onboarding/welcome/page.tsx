import type { Metadata } from 'next';
import {
  onboardingStepHref,
  type SearchParams,
} from '../../../../features/access/decision';
import { WhyStep } from '../../../../ui/onboarding/intro/intro';
import { readStepEntry, stepRobots } from '../step-entry';

export const metadata: Metadata = { title: 'Why debate', robots: stepRobots };

export default async function OnboardingWhyStepPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { destination } = await readStepEntry(searchParams, 'welcome');
  return (
    <WhyStep
      nextHref={onboardingStepHref('daisy', destination)}
      backHref={null}
      skip={null}
    />
  );
}
