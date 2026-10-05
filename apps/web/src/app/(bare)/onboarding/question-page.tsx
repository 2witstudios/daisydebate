import {
  onboardingStepHref,
  type OnboardingStep,
  type SearchParams,
} from '../../../features/access/decision';
import type { QuestionStep } from '../../../features/onboarding/answers';
import { readOnboardingAnswers } from './actions';
import { QuestionForm } from '../../../ui/onboarding/questions/question-form';
import { saveStepAction } from './actions';
import { stepSkip } from './skip';
import { readStepEntry } from './step-entry';

const previous: Record<QuestionStep, OnboardingStep> = {
  about: 'debate',
  experience: 'about',
  topics: 'experience',
};

/** A questionnaire step's page: the member's saved answers, bound forms. */
export async function QuestionPage({
  step,
  searchParams,
}: {
  readonly step: QuestionStep;
  readonly searchParams: Promise<SearchParams>;
}) {
  const { destination } = await readStepEntry(searchParams, step);
  return (
    <QuestionForm
      step={step}
      action={saveStepAction.bind(null, step, destination)}
      answers={await readOnboardingAnswers()}
      backHref={onboardingStepHref(previous[step], destination)}
      skip={stepSkip(destination)}
    />
  );
}
