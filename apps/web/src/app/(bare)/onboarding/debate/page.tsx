import type { Metadata } from 'next';
import {
  onboardingStepHref,
  type SearchParams,
} from '../../../../features/access/decision';
import { DebateStep } from '../../../../ui/onboarding/intro/debate-step';
import { stepSkip } from '../skip';
import { readStepEntry, stepRobots } from '../step-entry';

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
  return (
    <DebateStep
      nextHref={onboardingStepHref('about', destination)}
      backHref={onboardingStepHref('daisy', destination)}
      skip={stepSkip(destination)}
    />
  );
}
