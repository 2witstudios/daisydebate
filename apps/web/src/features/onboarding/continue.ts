import {
  onboardingStepHref,
  welcomeHref,
  type OnboardingStep,
  type SearchParams,
} from '../access/decision';
import type { QuestionStep } from './answers';

/** Whether a local path is already one of the onboarding steps. */
const isOnboardingPath = (destination: string): boolean =>
  /^\/onboarding\/[a-z]+\/?(?:[?#]|$)/.test(destination);

/**
 * Where a member goes once the passkey offer is behind them: the
 * onboarding flow, then the destination; straight to the destination for
 * a member who already finished (or skipped) it, or whose destination is
 * itself an onboarding step (Help's link), so the flow never wraps itself.
 */
export const afterPasskeyHref = (
  destination: string,
  completedAt: string | null,
): string =>
  completedAt === null && !isOnboardingPath(destination)
    ? welcomeHref(destination)
    : destination;

const following: Record<QuestionStep, OnboardingStep> = {
  about: 'experience',
  experience: 'topics',
  topics: 'ready',
};

/** Whether a question step was opened to change one answer (`edit=1`). */
export const isEditing = (searchParams: SearchParams): boolean =>
  searchParams.edit === '1';

/**
 * Where a saved question step leads (ISSUE-324): on through the flow during
 * onboarding, or straight back to the destination when the member opened
 * the step to change one answer, as Settings' Edit links do.
 */
export const afterStepHref = (
  step: QuestionStep,
  destination: string,
  editing: boolean,
): string =>
  editing ? destination : onboardingStepHref(following[step], destination);
