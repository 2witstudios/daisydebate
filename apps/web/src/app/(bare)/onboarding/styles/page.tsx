import type { Metadata } from 'next';
import type { SearchParams } from '../../../../features/access/decision';
import { StylesStep } from '../../../../ui/onboarding/intro/styles-step';
import { stepSkip } from '../skip';
import { readStepEntry, stepRobots } from '../step-entry';
import { readStepLinks } from '../step-links';

export const metadata: Metadata = {
  title: 'Ranked ladders and custom formats',
  robots: stepRobots,
};

export default async function OnboardingStylesStepPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { destination } = await readStepEntry(searchParams, 'styles');
  const { nextHref, backHref } = await readStepLinks('styles', destination);
  return (
    <StylesStep
      nextHref={nextHref}
      backHref={backHref}
      skip={stepSkip(destination)}
    />
  );
}
