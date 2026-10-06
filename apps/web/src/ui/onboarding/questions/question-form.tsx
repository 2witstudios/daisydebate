'use client';

import type { ReactNode } from 'react';
import type {
  OnboardingAnswers,
  QuestionStep,
} from '../../../features/onboarding/answers';
import {
  useFocusAfterAnswer,
  useFormAction,
  type FormAction,
} from '../../form-action/form-action';
import { useMovedOn } from '../../form-action/use-moved-on';
import { AboutStep, ExperienceStep, TopicsStep } from './questions';
import { initialStepForm, type StepFormState } from './step-form-state';
import { refusedStep } from './submit-step';

const steps = {
  about: AboutStep,
  experience: ExperienceStep,
  topics: TopicsStep,
} as const;

/**
 * A questionnaire step bound to its server action. The form posts to the
 * action itself, so a submit before hydration or without JavaScript is the
 * same POST; JavaScript adds the pending state, keeps the choices when the
 * call fails in transport (ISSUE-94), focuses the heading after a refusal
 * (ISSUE-107) and navigates once the save landed.
 */
export function QuestionForm({
  step,
  action,
  answers,
  backHref,
  skip,
}: {
  readonly step: QuestionStep;
  readonly action: FormAction<StepFormState>;
  readonly answers: OnboardingAnswers;
  readonly backHref: string;
  readonly skip: ReactNode;
}) {
  const [answered, post, posting] = useFormAction(
    action,
    initialStepForm,
    refusedStep(step),
  );
  useMovedOn(answered.next);
  const pending = posting || answered.next !== undefined;
  useFocusAfterAnswer(answered, 'onboarding-title', !pending);
  const Step = steps[step];
  return (
    <Step
      answers={{ ...answers, ...answered.posted }}
      action={post}
      pending={pending}
      refused={answered.refused === true}
      backHref={backHref}
      skip={skip}
    />
  );
}
