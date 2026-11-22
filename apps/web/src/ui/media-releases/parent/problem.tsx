import { StatusRegion } from '../../components/status-region/status-region';
import type {
  ManageState,
  SentState,
  SignState,
} from '../../../features/media-releases/parent-forms';
import { errorClass } from '../../components/form-field/form-field-class';

type Answer = ManageState | SentState | SignState;

/** The line a parent form shows under it: its refusal, or that its answer was lost. */
export const problemOf = (answers: readonly Answer[]): string | undefined => {
  for (const answer of answers)
    if (answer.kind === 'refused') return answer.error;
  return answers.some((answer) => answer.kind === 'unacknowledged')
    ? 'We could not tell whether that went through. Check your connection and try again.'
    : undefined;
};

export function Problem({ state }: { readonly state: Answer }) {
  const problem = problemOf([state]);
  return problem === undefined ? null : (
    <StatusRegion as="p" role="alert" className={errorClass}>
      {problem}
    </StatusRegion>
  );
}
