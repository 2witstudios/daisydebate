import type { OnboardingAnswers } from '../../../features/onboarding/answers';
import {
  idle,
  type Idle,
  type Moved,
} from '../../../features/forms/form-state';

/**
 * The save was refused or never arrived. `posted` is the choices as posted,
 * so the form React resets after an action shows them again instead of what
 * was saved before.
 */
export type StepUnsaved = {
  readonly kind: 'unsaved';
  readonly posted: Partial<OnboardingAnswers>;
};

/** What a questionnaire or Skip form's server action answers. */
export type StepFormState = Idle | StepUnsaved | Moved;

export const initialStepForm: StepFormState = idle();

/** Skip posts no choices, so it has none to show again. */
export const stepUnsaved = (
  posted: Partial<OnboardingAnswers> = {},
): StepUnsaved => ({ kind: 'unsaved', posted });

/** What a step renders: the choices to lay over the saved ones, and whether to say it did not save. */
export type StepFields = {
  readonly posted: Partial<OnboardingAnswers>;
  readonly unsaved: boolean;
};

const nothingPosted: StepFields = { posted: {}, unsaved: false };

export function stepFields(answer: StepFormState): StepFields {
  switch (answer.kind) {
    case 'idle':
    case 'moved':
      return nothingPosted;
    case 'unsaved':
      return { posted: answer.posted, unsaved: true };
  }
}
