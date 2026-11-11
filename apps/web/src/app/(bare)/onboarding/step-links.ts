import { redirect } from 'next/navigation';
import {
  nextStepHref,
  optionalAnswersBearOn,
  previousStepHref,
  stepAdmits,
  type OnboardingStep,
} from '../../../features/onboarding/steps';
import { requestOptionalAnswersAdmitted } from '../../../lib/request-session';

/**
 * A step's way forward and back for this render's member, read from the
 * ordered flow. A member the step does not admit passes on to the next
 * step that does; nothing is asked, so nothing is stored (ISSUE-645). The
 * canonical age fact is read only for a step it bears on.
 */
export async function readStepLinks(
  step: OnboardingStep,
  destination: string,
): Promise<{ readonly nextHref: string; readonly backHref: string | null }> {
  const admitted =
    optionalAnswersBearOn(step) && (await requestOptionalAnswersAdmitted());
  const nextHref = nextStepHref(step, admitted, destination);
  if (!stepAdmits(step, admitted)) redirect(nextHref);
  return { nextHref, backHref: previousStepHref(step, admitted, destination) };
}
