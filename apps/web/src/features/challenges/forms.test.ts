import { assert, setupRitewayBun, test } from 'riteway/bun';
import { moved } from '../forms/form-state';
import {
  challengeEnded,
  challengeFields,
  challengeFormUnavailable,
  challengeRefused,
  challengeSent,
  initialChallengeForm,
  type ChallengeFormState,
} from './forms';

setupRitewayBun();

const answers: Readonly<
  Record<ChallengeFormState['kind'], ChallengeFormState>
> = {
  idle: initialChallengeForm,
  refused: challengeRefused('Leave your room first.'),
  sent: challengeSent,
  done: challengeEnded,
  moved: moved('/rooms/room'),
};

test('a challenge answer is exactly one outcome', () => {
  assert({
    given: 'one answer of every kind',
    should: 'carry only what that outcome means',
    actual: Object.values(answers),
    expected: [
      { kind: 'idle', values: {} },
      { kind: 'refused', values: {}, error: 'Leave your room first.' },
      { kind: 'sent' },
      { kind: 'done' },
      { kind: 'moved', next: '/rooms/room' },
    ],
  });
});

test('a challenge form says something only when refused or sent', () => {
  assert({
    given: 'one answer of every kind',
    should:
      'show a refusal as a refusal, confirm a sent offer without calling it one, and say nothing otherwise',
    actual: Object.fromEntries(
      Object.entries(answers).map(([kind, answer]) => [
        kind,
        challengeFields(answer),
      ]),
    ),
    expected: {
      idle: { notice: undefined, refusal: undefined },
      refused: {
        notice: 'Leave your room first.',
        refusal: 'Leave your room first.',
      },
      sent: { notice: 'Challenge sent.', refusal: undefined },
      done: { notice: undefined, refusal: undefined },
      moved: { notice: undefined, refusal: undefined },
    },
  });
  assert({
    given: 'a call that never reached Daisy',
    should: 'be a refusal that says to try again',
    actual: challengeFormUnavailable(),
    expected: {
      kind: 'refused',
      values: {},
      error: 'Could not reach Daisy. Try again.',
    },
  });
});
