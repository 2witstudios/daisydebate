import type { OnboardingAnswers } from '../features/onboarding/answers';
import { afterPasskeyHref } from '../features/onboarding/continue';
import { processApp } from '../server/process-app';
import { requestIdentity } from './request-session';

/** A member's stored onboarding answers, for a step's server render. */
export const readOnboardingAnswers = (
  userId: string,
): Promise<OnboardingAnswers> => processApp().database.readOnboarding(userId);

/**
 * Where this request's account goes after the passkey offer: onboarding
 * unless it already finished it. Anyone but a member goes to the
 * destination, where the access guard decides.
 */
export async function afterPasskey(destination: string): Promise<string> {
  const identity = await requestIdentity();
  if (identity.state !== 'member') return destination;
  const { completedAt } = await readOnboardingAnswers(
    identity.principal.userId,
  );
  return afterPasskeyHref(destination, completedAt);
}
