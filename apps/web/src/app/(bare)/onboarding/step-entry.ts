import { redirect } from 'next/navigation';
import { readOnboardingEntry } from '../../../lib/auth-entry';
import {
  onboardingHref,
  onboardingStepHref,
  type OnboardingStep,
  type SearchParams,
} from '../../../features/access/decision';

/**
 * An onboarding step's entry, after the passkey offer: the validated
 * destination for a member. Anonymous visitors sign in and come back here;
 * an account still choosing a name goes back to that step.
 */
export async function readStepEntry(
  searchParams: Promise<SearchParams>,
  step: OnboardingStep,
): Promise<{ readonly destination: string; readonly userId: string }> {
  const { destination, identity } = await readOnboardingEntry(
    searchParams,
    (next) => onboardingStepHref(step, next),
  );
  if (identity.state === 'provisional') redirect(onboardingHref(destination));
  return { destination, userId: identity.principal.userId };
}

/** Every onboarding step is a private page. */
export const stepRobots = { index: false, follow: false } as const;
