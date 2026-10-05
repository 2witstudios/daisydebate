'use server';

import { headers } from 'next/headers';
import { createAppError } from '@daisy/errors';
import {
  parseStoredAnswers,
  type OnboardingAnswers,
} from '../../../features/onboarding/answers';
import { afterPasskeyHref } from '../../../features/onboarding/continue';
import { requestIdentity } from '../../../lib/request-session';

import {
  onboardingStepHref,
  type OnboardingStep,
} from '../../../features/access/decision';
import type { QuestionStep } from '../../../features/onboarding/answers';
import { returnableDestination } from '../../../features/auth/redirect';
import { moveOn } from '../../../server/form-action';
import { inProcessFetch } from '../../../server/in-process-fetch';
import { processRoute } from '../../../server/process-app';
import {
  createSubmitStep,
  refusedStep,
  stepBody,
} from '../../../ui/onboarding/questions/submit-step';
import type { StepFormState } from '../../../ui/onboarding/questions/step-form-state';

const onboardingRoute = processRoute((routes) => routes.onboarding.POST);

const following: Record<QuestionStep, OnboardingStep> = {
  about: 'experience',
  experience: 'topics',
  topics: 'ready',
};

const isQuestionStep = (value: unknown): value is QuestionStep =>
  typeof value === 'string' && Object.hasOwn(following, value);

/**
 * A questionnaire step's POST, as a server action: it works before
 * hydration and without JavaScript. It runs POST /api/account/onboarding in
 * process with this request's headers, so every gate of that route applies.
 * Every argument comes from the browser: the step and `next` are checked
 * again here. The topics step also finishes onboarding. A saved step moves
 * on (a 303 without JavaScript, `next` for a hydrated page to navigate to).
 */
export async function saveStepAction(
  step: unknown,
  next: unknown,
  _state: StepFormState,
  form: unknown,
): Promise<StepFormState> {
  if (!isQuestionStep(step)) return { refused: true };
  const destination = returnableDestination(
    typeof next === 'string' ? next : undefined,
  );
  const posted = form instanceof FormData ? form : new FormData();
  const incoming = new Headers(await headers());
  const submit = createSubmitStep(inProcessFetch(onboardingRoute, incoming));
  if (
    (await submit(stepBody(step, posted))) !== 'saved' ||
    (step === 'topics' && (await submit({ step: 'finish' })) !== 'saved')
  )
    return refusedStep(step)(posted);
  return moveOn(incoming, onboardingStepHref(following[step], destination));
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
  if ((await submit({ step: 'finish' })) !== 'saved') return { refused: true };
  return moveOn(incoming, onboardingStepHref('ready', destination));
}

const readRoute = processRoute((routes) => routes.onboarding.GET);

/**
 * This request's member's stored answers, for a step's server render (never
 * bound to a client form): GET
 * /api/account/onboarding in process with the request's own headers, so
 * the route's gates decide whose answers come back.
 */
export async function readOnboardingAnswers(): Promise<OnboardingAnswers> {
  const response = await inProcessFetch(
    readRoute,
    new Headers(await headers()),
  )('/api/account/onboarding', { method: 'GET' });
  const answers = response.ok
    ? parseStoredAnswers(await response.json())
    : null;
  if (answers === null) throw createAppError('INFRASTRUCTURE');
  return answers;
}

/**
 * Where this request's account goes after the passkey offer: onboarding
 * unless it already finished it. Anyone but a member goes to the
 * destination, where the access guard decides.
 */
export async function afterPasskey(destination: string): Promise<string> {
  if ((await requestIdentity()).state !== 'member') return destination;
  return afterPasskeyHref(
    destination,
    (await readOnboardingAnswers()).completedAt,
  );
}
