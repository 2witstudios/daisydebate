import type { Metadata } from 'next';
import type { SearchParams } from '../../../../features/access/decision';
import { DaisyStep } from '../../../../ui/onboarding/intro/intro';
import { requestHostToolsReleased } from '../host-release';
import { stepSkip } from '../skip';
import { readStepEntry, stepRobots } from '../step-entry';
import { readStepLinks } from '../step-links';

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
  const [{ nextHref, backHref }, released] = await Promise.all([
    readStepLinks('daisy', destination),
    requestHostToolsReleased(),
  ]);
  return (
    <DaisyStep
      nextHref={nextHref}
      backHref={backHref}
      skip={stepSkip(destination)}
      tabReleased={released}
    />
  );
}
