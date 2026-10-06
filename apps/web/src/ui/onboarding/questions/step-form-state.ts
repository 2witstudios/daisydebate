import type { OnboardingAnswers } from '../../../features/onboarding/answers';

/** What a questionnaire or Skip form's server action answers. */
export type StepFormState = {
  /** The save was refused or never arrived. */
  readonly refused?: boolean;
  /**
   * The choices as posted, so the form React resets after an action shows
   * them again instead of what was saved before.
   */
  readonly posted?: Partial<OnboardingAnswers>;
  /** Where a hydrated page navigates once the save landed. */
  readonly next?: string;
};

export const initialStepForm: StepFormState = {};
