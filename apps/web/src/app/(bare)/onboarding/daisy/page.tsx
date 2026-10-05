import type { Metadata } from 'next';
import {
  onboardingStepHref,
  type SearchParams,
} from '../../../../features/access/decision';
import { DaisyStep } from '../../../../ui/onboarding/intro/intro';
import { readStepEntry, stepRobots } from '../step-entry';

export const metadata: Metadata = {
  title: 'How Daisy works',
  robots: stepRobots,
};

export default async function OnboardingDaisyStepPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { destination } = await readStepEntry(searchParams, 'daisy');
  return (
    <DaisyStep
      nextHref={onboardingStepHref('debate', destination)}
      backHref={onboardingStepHref('welcome', destination)}
      skip={null}
    />
  );
}
