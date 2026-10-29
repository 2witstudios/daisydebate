import type { Metadata } from 'next';
import type { SearchParams } from '../../../../features/access/decision';
import { ReadyStep } from '../../../../ui/onboarding/ready/ready';
import { readStepEntry, stepRobots } from '../step-entry';

export const metadata: Metadata = {
  title: `You're ready`,
  robots: stepRobots,
};

/** The last step: a simple send-off to the lobby. */
export default async function OnboardingReadyPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { destination } = await readStepEntry(searchParams, 'ready');
  return <ReadyStep homeHref={destination} />;
}
