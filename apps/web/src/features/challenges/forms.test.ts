import { assert, setupRitewayBun, test } from 'riteway/bun';
import { moved } from '../forms/form-state';
import {
  challengeEnded,
  challengeFields,
  challengeFormUnavailable,
  challengeRefused,
  challengeSent,
  initialChallengeForm,
  sendRefusal,
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

test('a ranked offer refused on the sender’s age says so, not leave your room', () => {
  assert({
    given: 'a 409 naming ranked-age, then a 409 naming nothing',
    should: 'give the ranked age reason, then the status words',
    actual: [
      sendRefusal(409, { code: 'CONFLICT', refusal: 'ranked-age' }),
      sendRefusal(409, null),
    ],
    expected: [
      'Ranked play is for members 18 and over. A Scholastic ladder for members under 18 is coming.',
      'Leave your room first.',
    ],
  });
});
