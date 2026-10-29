import type { Metadata } from 'next';
import {
  onboardingStepHref,
  type SearchParams,
} from '../../../../features/access/decision';
import { StylesStep } from '../../../../ui/onboarding/intro/styles-step';
import { stepSkip } from '../skip';
import { readStepEntry, stepRobots } from '../step-entry';

export const metadata: Metadata = {
  title: 'Three ways to debate',
  robots: stepRobots,
};

export default async function OnboardingStylesStepPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { destination } = await readStepEntry(searchParams, 'styles');
  return (
    <StylesStep
      nextHref={onboardingStepHref('debate', destination)}
      backHref={onboardingStepHref('daisy', destination)}
      skip={stepSkip(destination)}
    />
  );
}
