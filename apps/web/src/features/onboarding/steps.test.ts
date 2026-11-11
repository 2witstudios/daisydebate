import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { isQuestionStep } from './answers';
import {
  finishesOnboarding,
  introductionHref,
  nextStep,
  nextStepHref,
  onboardingStepHref,
  onboardingSteps,
  optionalAnswersBearOn,
  previousStep,
  previousStepHref,
  sendOffHref,
  stepAdmits,
  type OnboardingStep,
} from './steps';

setupRitewayBun();

type Row = readonly [
  step: OnboardingStep,
  admits: boolean,
  next: OnboardingStep | null,
  previous: OnboardingStep | null,
];

/** Every step for a member optional answers admit. */
const admitted: readonly Row[] = [
  ['daisy', true, 'styles', null],
  ['styles', true, 'debate', 'daisy'],
  ['debate', true, 'about', 'styles'],
  ['about', true, 'experience', 'debate'],
  ['experience', true, 'topics', 'about'],
  ['topics', true, 'ready', 'experience'],
  ['ready', true, null, 'topics'],
];

/** Every step for a member they do not: the questions are passed over. */
const notAdmitted: readonly Row[] = [
  ['daisy', true, 'styles', null],
  ['styles', true, 'debate', 'daisy'],
  ['debate', true, 'ready', 'styles'],
  ['about', false, 'ready', 'debate'],
  ['experience', false, 'ready', 'debate'],
  ['topics', false, 'ready', 'debate'],
  ['ready', true, null, 'debate'],
];

const read = (optionalAnswersAdmitted: boolean): readonly Row[] =>
  onboardingSteps.map((step) => [
    step,
    stepAdmits(step, optionalAnswersAdmitted),
    nextStep(step, optionalAnswersAdmitted),
    previousStep(step, optionalAnswersAdmitted),
  ]);

/** The steps met walking forward from the first until none is left. */
const walk = (optionalAnswersAdmitted: boolean): readonly OnboardingStep[] => {
  const met: OnboardingStep[] = [];
  let step: OnboardingStep | null = onboardingSteps[0] ?? null;
  while (step !== null && met.length <= onboardingSteps.length) {
    met.push(step);
    step = nextStep(step, optionalAnswersAdmitted);
  }
  return met;
};

describe('the onboarding flow', () => {
  test('every step, for a member optional answers admit and one they do not', () => {
    assert({
      given: 'each step for a member optional answers admit',
      should: 'admit them to every step, in the order of the flow',
      actual: read(true),
      expected: admitted,
    });
    assert({
      given: 'each step for a member optional answers do not admit',
      should:
        'refuse the three questions, send them on to the send-off and back to the debate step',
      actual: read(false),
      expected: notAdmitted,
    });
    assert({
      given: 'the two tables',
      should: 'cover every step once',
      actual: [
        admitted.map(([step]) => step),
        notAdmitted.map(([step]) => step),
      ],
      expected: [onboardingSteps, onboardingSteps],
    });
  });

  test('the order is total', () => {
    assert({
      given: 'a walk forward from the first step',
      should:
        'meet every step once for an admitted member, and every step but the questions otherwise, ending on the send-off',
      actual: [walk(true), walk(false)],
      expected: [
        onboardingSteps,
        onboardingSteps.filter((step) => !isQuestionStep(step)),
      ],
    });
    for (const optionalAnswersAdmitted of [true, false])
      assert({
        given: `each step that admits a member (optional answers ${
          optionalAnswersAdmitted ? 'admitted' : 'not admitted'
        })`,
        should: 'be the previous step of its own next step',
        actual: walk(optionalAnswersAdmitted)
          .slice(0, -1)
          .map((step) => {
            const next = nextStep(step, optionalAnswersAdmitted);
            return next && previousStep(next, optionalAnswersAdmitted);
          }),
        expected: walk(optionalAnswersAdmitted).slice(0, -1),
      });
  });

  test('the steps that ask optional answers are the question steps', () => {
    assert({
      given: 'every step',
      should:
        'need optional answers admitted exactly when it is a question step, the last of which finishes onboarding',
      actual: onboardingSteps.map((step) => [
        step,
        !stepAdmits(step, false),
        finishesOnboarding(step),
      ]),
      expected: onboardingSteps.map((step) => [
        step,
        isQuestionStep(step),
        step === 'topics',
      ]),
    });
  });

  test('the fact is read only where it changes something shown', () => {
    assert({
      given: 'every step',
      should:
        'need the optional-answers fact from the debate step on, never for the two steps before it',
      actual: onboardingSteps.filter(optionalAnswersBearOn),
      expected: ['debate', 'about', 'experience', 'topics', 'ready'],
    });
  });
});

describe('onboarding step links', () => {
  test('carry the destination as one encoded next value', () => {
    assert({
      given: 'the opening step, a later step and the send-off',
      should: 'name the step and encode the destination once',
      actual: [
        introductionHref('/ranked?tab=a'),
        onboardingStepHref('topics', '/lobby'),
        sendOffHref('/lobby'),
      ],
      expected: [
        '/onboarding/daisy?next=%2Franked%3Ftab%3Da',
        '/onboarding/topics?next=%2Flobby',
        '/onboarding/ready?next=%2Flobby',
      ],
    });
  });

  test('forward and back from a step', () => {
    assert({
      given:
        'the debate step either way, the first step going back, and the last going forward',
      should:
        'lead to the next or previous step that admits the member, nowhere before the first, and to the destination after the last',
      actual: [
        nextStepHref('debate', true, '/lobby'),
        nextStepHref('debate', false, '/lobby'),
        previousStepHref('about', true, '/lobby'),
        previousStepHref('daisy', true, '/lobby'),
        nextStepHref('ready', true, '/lobby?tab=a'),
      ],
      expected: [
        '/onboarding/about?next=%2Flobby',
        '/onboarding/ready?next=%2Flobby',
        '/onboarding/debate?next=%2Flobby',
        null,
        '/lobby?tab=a',
      ],
    });
  });
});
