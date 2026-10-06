import {
  parseStepAnswers,
  type OnboardingAnswers,
  type QuestionStep,
} from '../../../features/onboarding/answers';
import type { StepFormState } from './step-form-state';

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const lists: Record<QuestionStep, readonly string[]> = {
  about: ['wants'],
  experience: ['formats'],
  topics: ['topics'],
};
const singles: Record<QuestionStep, readonly string[]> = {
  about: ['club'],
  experience: ['experience', 'length'],
  topics: [],
};

/**
 * The JSON body for one questionnaire step from its posted form: its lists
 * (one field per checked box) and its single choices, left out when
 * nothing was chosen. Fields from other steps are never read; the server
 * checks every value again.
 */
export function stepBody(
  step: QuestionStep,
  form: FormData,
): Record<string, unknown> {
  const body: Record<string, unknown> = { step };
  for (const name of lists[step])
    body[name] = form.getAll(name).filter((value) => typeof value === 'string');
  for (const name of singles[step]) {
    const value = form.get(name);
    if (typeof value === 'string') body[name] = value;
  }
  return body;
}

export type StepOutcome = 'saved' | 'refused' | 'unavailable';

/**
 * A step (or finish) over POST /api/account/onboarding. Only a 400 is the
 * member's answer refused; anything else that is not a success means the
 * save did not happen and is worth trying again.
 */
export const createSubmitStep =
  (fetchImpl: FetchLike) =>
  async (body: Record<string, unknown>): Promise<StepOutcome> => {
    let response: Response;
    try {
      response = await fetchImpl('/api/account/onboarding', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      return 'unavailable';
    }
    if (response.ok) return 'saved';
    return response.status === 400 ? 'refused' : 'unavailable';
  };

/**
 * The posted choices that are on their lists, as answers the step can
 * show again; a post the parser refuses shows nothing new.
 */
function postedAnswers(
  step: QuestionStep,
  form: FormData,
): Partial<OnboardingAnswers> {
  const parsed = parseStepAnswers(stepBody(step, form));
  if (!parsed.ok) return {};
  const answers: Record<string, unknown> = { ...parsed.value };
  delete answers.step;
  return answers as Partial<OnboardingAnswers>;
}

/** A step's answer when its save was refused or never arrived. */
export const refusedStep =
  (step: QuestionStep) =>
  (form: FormData): StepFormState => ({
    refused: true,
    posted: postedAnswers(step, form),
  });
