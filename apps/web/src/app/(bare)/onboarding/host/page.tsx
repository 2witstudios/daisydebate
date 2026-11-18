import type { Metadata } from 'next';
import type { SearchParams } from '../../../../features/access/decision';
import { HostStep } from '../../../../ui/onboarding/intro/host-step';
import { tabReleased } from '../../../tab-release';
import { stepSkip } from '../skip';
import { readStepEntry, stepRobots } from '../step-entry';
import { readStepLinks } from '../step-links';

export const metadata: Metadata = {
  title: 'Run your league',
  robots: stepRobots,
};

export default async function OnboardingHostStepPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { destination } = await readStepEntry(searchParams, 'host');
  const [{ nextHref, backHref }, released] = await Promise.all([
    readStepLinks('host', destination),
    tabReleased(),
  ]);
  return (
    <HostStep
      nextHref={nextHref}
      backHref={backHref}
      skip={stepSkip(destination)}
      tabReleased={released}
    />
  );
}
