/** The send-off: the step every walk and every Skip ends on. */
const sendOff = { step: 'ready', asksOptionalAnswers: false } as const;

/**
 * The onboarding flow after the passkey offer, in the order a member walks
 * it. A step that asks optional answers admits only a member whose
 * canonical age admits them (16 or over, DEC-106); everyone else passes
 * over it in both directions.
 */
const flow = [
  { step: 'daisy', asksOptionalAnswers: false },
  { step: 'styles', asksOptionalAnswers: false },
  { step: 'debate', asksOptionalAnswers: false },
  { step: 'about', asksOptionalAnswers: true },
  { step: 'experience', asksOptionalAnswers: true },
  { step: 'topics', asksOptionalAnswers: true },
  sendOff,
] as const;

export type OnboardingStep = (typeof flow)[number]['step'];

/** Every step, in flow order. */
export const onboardingSteps: readonly OnboardingStep[] = flow.map(
  ({ step }) => step,
);

/**
 * How many steps show a count: every step but the send-off. The count is of
 * the whole flow for every member, so one whose age passes over the optional
 * answers goes from the third of six to the send-off.
 */
export const numberedSteps = onboardingSteps.length - 1;

/** A step's 1-based place in the flow, or null on the send-off, which shows no count. */
export const stepNumber = (step: OnboardingStep): number | null =>
  step === sendOff.step ? null : onboardingSteps.indexOf(step) + 1;

const asksOptionalAnswers = (step: OnboardingStep): boolean =>
  flow.some((entry) => entry.step === step && entry.asksOptionalAnswers);

/** Whether a step is shown to a member, given the optional-answers fact. */
export const stepAdmits = (
  step: OnboardingStep,
  optionalAnswersAdmitted: boolean,
): boolean => optionalAnswersAdmitted || !asksOptionalAnswers(step);

/** The nearest step that admits the member, walking one way from `step`. */
const nearest = (
  step: OnboardingStep,
  direction: 1 | -1,
  optionalAnswersAdmitted: boolean,
): OnboardingStep | null => {
  const ahead =
    direction === 1
      ? onboardingSteps.slice(onboardingSteps.indexOf(step) + 1)
      : onboardingSteps.slice(0, onboardingSteps.indexOf(step)).reverse();
  return (
    ahead.find((candidate) => stepAdmits(candidate, optionalAnswersAdmitted)) ??
    null
  );
};

/** The step a member goes on to, or null after the last. */
export const nextStep = (
  step: OnboardingStep,
  optionalAnswersAdmitted: boolean,
): OnboardingStep | null => nearest(step, 1, optionalAnswersAdmitted);

/** The step a member goes back to, or null before the first. */
export const previousStep = (
  step: OnboardingStep,
  optionalAnswersAdmitted: boolean,
): OnboardingStep | null => nearest(step, -1, optionalAnswersAdmitted);

/**
 * Whether the optional-answers fact changes anything about a step: whether
 * it is shown, or which step lies either side of it. A step it does not
 * bear on needs no read of the fact.
 */
export const optionalAnswersBearOn = (step: OnboardingStep): boolean =>
  stepAdmits(step, true) !== stepAdmits(step, false) ||
  nextStep(step, true) !== nextStep(step, false) ||
  previousStep(step, true) !== previousStep(step, false);

/**
 * Whether saving a step finishes onboarding: on a full walk only the
 * send-off is left after it, so its answers and the completion are one
 * write.
 */
export const finishesOnboarding = (step: OnboardingStep): boolean =>
  nextStep(step, true) === sendOff.step;

/** One onboarding step, then the already validated destination. */
export const onboardingStepHref = (
  step: OnboardingStep,
  destination: string,
): string => `/onboarding/${step}?next=${encodeURIComponent(destination)}`;

/** The first onboarding step, where the passkey offer's exits lead. */
export const introductionHref = (destination: string): string =>
  onboardingStepHref(flow[0].step, destination);

/** The last step, where Skip leads from any step. */
export const sendOffHref = (destination: string): string =>
  onboardingStepHref(sendOff.step, destination);

/** Where a step's way forward leads: the next step, or the destination after the last. */
export const nextStepHref = (
  step: OnboardingStep,
  optionalAnswersAdmitted: boolean,
  destination: string,
): string => {
  const next = nextStep(step, optionalAnswersAdmitted);
  return next === null ? destination : onboardingStepHref(next, destination);
};

/** Where a step's Back leads, or null on the first step, which has none. */
export const previousStepHref = (
  step: OnboardingStep,
  optionalAnswersAdmitted: boolean,
  destination: string,
): string | null => {
  const previous = previousStep(step, optionalAnswersAdmitted);
  return previous === null ? null : onboardingStepHref(previous, destination);
};
