import type { SearchParams } from '../../../features/access/decision';
import type { QuestionStep } from '../../../features/onboarding/answers';
import { readOnboardingAnswers } from './answers';
import { QuestionForm } from '../../../ui/onboarding/questions/question-form';
import { saveStepAction } from './actions';
import { stepSkip } from './skip';
import { readStepEntry } from './step-entry';
import { readStepLinks } from './step-links';
import { isEditing } from '../../../features/onboarding/continue';

/**
 * A questionnaire step's page: the member's saved answers, bound forms. A
 * member whose canonical age does not admit optional answers passes on to the
 * next step that admits them; nothing is asked, so nothing is stored (ISSUE-645).
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
  const { backHref } = await readStepLinks(step, destination);
  return (
    <QuestionForm
      step={step}
      action={saveStepAction.bind(null, step, destination, editing)}
      answers={await readOnboardingAnswers()}
      backHref={editing ? destination : (backHref ?? destination)}
      skip={editing ? null : stepSkip(destination)}
      editing={editing}
    />
  );
}
