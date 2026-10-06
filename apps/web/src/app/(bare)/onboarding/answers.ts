import { createAppError } from '@daisy/errors';
import type { OnboardingAnswers } from '../../../features/onboarding/answers';
import { afterPasskeyHref } from '../../../features/onboarding/continue';
import { requestOnboardingAnswers } from '../../../lib/request-session';

/**
 * The signed-in member's own answers, for a step's server render. The
 * step's entry has already sent anyone who is not a member elsewhere.
 */
export async function readOnboardingAnswers(): Promise<OnboardingAnswers> {
  const answers = await requestOnboardingAnswers();
  if (answers === null) throw createAppError('AUTHORIZATION');
  return answers;
}

/**
 * Where this request's account goes after the passkey offer: onboarding
 * unless it already finished it. Anyone but a member goes to the
 * destination, where the access guard decides.
 */
export async function afterPasskey(destination: string): Promise<string> {
  const answers = await requestOnboardingAnswers();
  return answers === null
    ? destination
    : afterPasskeyHref(destination, answers.completedAt);
}
