import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import {
  betaHref,
  type SearchParams,
} from '../../../../features/access/decision';
import { ReadyStep } from '../../../../ui/onboarding/ready/ready';
import { readStepEntry, stepRobots } from '../step-entry';

export const metadata: Metadata = {
  title: `You're ready`,
  robots: stepRobots,
};

/**
 * The last step: a simple send-off to the lobby. Only an approved member
 * gets it; a waitlisted account waits on the beta page (ADR 0075).
 */
export default async function OnboardingReadyPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { destination, identity } = await readStepEntry(searchParams, 'ready');
  if (identity.state === 'waitlisted') redirect(betaHref(destination));
  return <ReadyStep homeHref={destination} />;
}
