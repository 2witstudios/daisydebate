import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  awaitsClaim,
  canSubmit,
  initialOnboardingState,
  onboardingReducer,
  type OnboardingEvent,
  type OnboardingState,
} from './username-state';

setupRitewayBun();

const run = (events: readonly OnboardingEvent[]): OnboardingState =>
  events.reduce(onboardingReducer, initialOnboardingState);
const typed = (username: string): OnboardingEvent => ({
  type: 'typed',
  username,
});

describe('onboardingReducer', () => {
  test('a well-formed name goes pending', () => {
    assert({
      given: 'a valid name submitted',
      should: 'be pending',
      actual: run([typed('Ada_1'), { type: 'submitted' }]),
      expected: { step: 'choose', username: 'Ada_1', pending: true },
    });
  });

  test('an invalid name is refused locally with a notice and stays editable', () => {
    assert({
      given: 'a name with a space',
      should: 'show the invalid notice without going pending',
      actual: run([typed('a b'), { type: 'submitted' }]),
      expected: {
        step: 'choose',
        username: 'a b',
        pending: false,
        notice: 'invalid',
      },
    });
  });

  test('a taken name keeps the typed name and explains', () => {
    assert({
      given: 'a claim the server answered with 409 taken',
      should: 'return to choosing with the taken notice',
      actual: run([
        typed('ada'),
        { type: 'submitted' },
        { type: 'claim-settled', outcome: { kind: 'taken' } },
      ]),
      expected: {
        step: 'choose',
        username: 'ada',
        pending: false,
        notice: 'taken',
      },
    });
  });

  test('typing clears the notice', () => {
    assert({
      given: 'a notice showing and then more typing',
      should: 'clear the notice',
      actual: run([
        typed('ada'),
        { type: 'submitted' },
        { type: 'claim-settled', outcome: { kind: 'taken' } },
        typed('ada2'),
      ]),
      expected: { step: 'choose', username: 'ada2', pending: false },
    });
  });

  test('a claim moves on to the passkey offer with the stored name', () => {
    assert({
      given: 'a successful claim',
      should: 'show the passkey step for the stored name, then finish',
      actual: [
        run([
          typed('Ada'),
          { type: 'submitted' },
          {
            type: 'claim-settled',
            outcome: { kind: 'claimed', username: 'ada' },
          },
        ]),
        run([
          typed('Ada'),
          { type: 'submitted' },
          {
            type: 'claim-settled',
            outcome: { kind: 'claimed', username: 'ada' },
          },
          { type: 'passkey-step-finished' },
        ]),
      ],
      expected: [
        { step: 'passkey', username: 'ada', saving: false },
        { step: 'done' },
      ],
    });
  });

  test('cannot submit twice or empty', () => {
    assert({
      given: 'an empty field and a pending claim',
      should: 'not be submittable',
      actual: [
        canSubmit(initialOnboardingState),
        canSubmit(run([typed('ada'), { type: 'submitted' }])),
      ],
      expected: [false, false],
    });
  });

  test('a settled claim nobody asked for changes nothing', () => {
    assert({
      given: 'a claim result while not pending',
      should: 'ignore it',
      actual: run([
        typed('ada'),
        { type: 'claim-settled', outcome: { kind: 'claimed', username: 'x' } },
      ]),
      expected: { step: 'choose', username: 'ada', pending: false },
    });
  });
});

describe('awaitsClaim', () => {
  test('only a submission that passed the local check calls the server', () => {
    assert({
      given: 'a valid submission, an invalid one and an unsubmitted name',
      should: 'await a claim for the valid one only',
      actual: [
        awaitsClaim(run([typed('ada'), { type: 'submitted' }])),
        awaitsClaim(run([typed('a b'), { type: 'submitted' }])),
        awaitsClaim(run([typed('ada')])),
      ],
      expected: [true, false, false],
    });
  });
});

describe('passkey offer', () => {
  const offered = run([
    typed('Ada'),
    { type: 'submitted' },
    { type: 'claim-settled', outcome: { kind: 'claimed', username: 'ada' } },
  ]);
  const settle = (kind: 'saved' | 'cancelled' | 'failed' | 'unavailable') =>
    [
      { type: 'enroll-started' } as const,
      { type: 'enroll-settled', outcome: { kind } } as const,
    ].reduce(onboardingReducer, offered);

  test('locks while enrolling and never claims a save it did not make', () => {
    assert({
      given: 'enrollment started, then each seam outcome',
      should:
        'lock the choices, finish only on saved, and explain every other outcome',
      actual: [
        onboardingReducer(offered, { type: 'enroll-started' }),
        settle('saved'),
        settle('unavailable'),
      ],
      expected: [
        { step: 'passkey', username: 'ada', saving: true },
        { step: 'done' },
        {
          step: 'passkey',
          username: 'ada',
          saving: false,
          notice:
            'Saving a passkey is not available yet, so nothing was saved. Email links keep working.',
        },
      ],
    });
  });

  test('a settle nobody started changes nothing', () => {
    assert({
      given: 'an enrollment result while not saving',
      should: 'ignore it',
      actual: onboardingReducer(offered, {
        type: 'enroll-settled',
        outcome: { kind: 'saved' },
      }),
      expected: offered,
    });
  });
});
