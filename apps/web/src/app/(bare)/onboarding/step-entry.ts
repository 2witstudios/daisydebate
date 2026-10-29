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
 * destination and the signed-in account. Anonymous visitors sign in and come
 * back here; an account still choosing a name goes back to that step.
 */
export async function readStepEntry(
  searchParams: Promise<SearchParams>,
  step: OnboardingStep,
): Promise<{
  readonly destination: string;
  readonly identity: Awaited<
    ReturnType<typeof readOnboardingEntry>
  >['identity'];
}> {
  const { destination, identity } = await readOnboardingEntry(
    searchParams,
    (next) => onboardingStepHref(step, next),
  );
  if (identity.state === 'provisional') redirect(onboardingHref(destination));
  return { destination, identity };
}

/** Every onboarding step is a private page. */
export const stepRobots = { index: false, follow: false } as const;
