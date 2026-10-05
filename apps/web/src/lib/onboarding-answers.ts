import type { OnboardingAnswers } from '../features/onboarding/answers';
import { processApp } from '../server/process-app';

/** A member's stored onboarding answers, for a step's server render. */
export const readOnboardingAnswers = (
  userId: string,
): Promise<OnboardingAnswers> => processApp().database.readOnboarding(userId);
