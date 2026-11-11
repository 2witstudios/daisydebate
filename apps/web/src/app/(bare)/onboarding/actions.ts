'use server';

import { headers } from 'next/headers';

import { isQuestionStep } from '../../../features/onboarding/answers';
import { afterStepHref } from '../../../features/onboarding/continue';
import { sendOffHref } from '../../../features/onboarding/steps';
import { returnableDestination } from '../../../features/auth/redirect';
import { moveOn } from '../../../server/form-action';
import { inProcessFetch } from '../../../server/in-process-fetch';
import { processRoute } from '../../../server/process-app';
import {
  createSubmitStep,
  refusedStep,
  stepBody,
} from '../../../ui/onboarding/questions/submit-step';
import {
  stepUnsaved,
  type StepFormState,
} from '../../../ui/onboarding/questions/step-form-state';

const onboardingRoute = processRoute((routes) => routes.onboarding.POST);

/**
 * A questionnaire step's POST, as a server action: it works before
 * hydration and without JavaScript. It runs POST /api/account/onboarding in
 * process with this request's headers, so every gate of that route applies.
 * Every argument comes from the browser: the step and `next` are checked
 * again here. The route finishes onboarding with the last question's own
 * write. A saved step moves
 * on (a 303 without JavaScript, `next` for a hydrated page to navigate to).
 */
export async function saveStepAction(
  step: unknown,
  next: unknown,
  editing: unknown,
  _state: StepFormState,
  form: unknown,
): Promise<StepFormState> {
  if (!isQuestionStep(step)) return stepUnsaved();
  const destination = returnableDestination(
    typeof next === 'string' ? next : undefined,
  );
  const posted = form instanceof FormData ? form : new FormData();
  const incoming = new Headers(await headers());
  const submit = createSubmitStep(inProcessFetch(onboardingRoute, incoming));
  if ((await submit(stepBody(step, posted))) !== 'saved')
    return refusedStep(step)(posted);
  return moveOn(incoming, afterStepHref(step, destination, editing === true));
}

/**
 * Skip, from any step: records that the member finished and moves on to
 * the last step. Answers already saved stay; nothing else is stored.
 */
export async function skipAction(
  next: unknown,
  _state: StepFormState,
  _form: unknown,
): Promise<StepFormState> {
  const destination = returnableDestination(
    typeof next === 'string' ? next : undefined,
  );
  const incoming = new Headers(await headers());
  const submit = createSubmitStep(inProcessFetch(onboardingRoute, incoming));
  if ((await submit({ step: 'finish' })) !== 'saved') return stepUnsaved();
  return moveOn(incoming, sendOffHref(destination));
}
