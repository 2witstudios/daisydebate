import {
  onboardingStepHref,
  type OnboardingStep,
  type SearchParams,
} from '../../../features/access/decision';
import type { QuestionStep } from '../../../features/onboarding/answers';
import { readOnboardingAnswers } from './answers';
import { QuestionForm } from '../../../ui/onboarding/questions/question-form';
import { saveStepAction } from './actions';
import { stepSkip } from './skip';
import { readStepEntry } from './step-entry';
import { redirect } from 'next/navigation';
import { requestOptionalAnswersAdmitted } from '../../../lib/request-session';
import { isEditing } from '../../../features/onboarding/continue';

const previous: Record<QuestionStep, OnboardingStep> = {
  about: 'debate',
  experience: 'about',
  topics: 'experience',
};

/**
 * A questionnaire step's page: the member's saved answers, bound forms. A
 * member whose canonical age does not admit optional answers skips to the
 * last step; nothing is asked, so nothing is stored (ISSUE-645).
 */
export async function QuestionPage({
  step,
  searchParams,
}: {
  readonly step: QuestionStep;
  readonly searchParams: Promise<SearchParams>;
}) {
  const { destination } = await readStepEntry(searchParams, step);
  // Opened from Settings to change one answer: save, then straight back.
  const editing = isEditing(await searchParams);
  if (!(await requestOptionalAnswersAdmitted()))
    redirect(onboardingStepHref('ready', destination));
  return (
    <QuestionForm
      step={step}
      action={saveStepAction.bind(null, step, destination, editing)}
      answers={await readOnboardingAnswers()}
      backHref={
        editing ? destination : onboardingStepHref(previous[step], destination)
      }
      skip={editing ? null : stepSkip(destination)}
      editing={editing}
    />
  );
}
