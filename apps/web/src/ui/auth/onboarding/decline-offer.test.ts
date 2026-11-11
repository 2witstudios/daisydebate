import { assert, setupRitewayBun, test } from 'riteway/bun';
import { destinationOf, moved } from '../../../features/forms/form-state';
import {
  declineUnavailable,
  initialDecline,
  type DeclineState,
} from './decline-offer';

setupRitewayBun();

test('a declined passkey offer answers nothing yet, or where the account goes next', () => {
  const answers: readonly DeclineState[] = [
    initialDecline,
    declineUnavailable(),
    moved('/onboarding'),
  ];
  assert({
    given:
      'nothing posted, a post that never reached the server, and a decline',
    should:
      'hold no destination until declined, and unlock the choices again when the post was lost',
    actual: answers.map((answer) => [answer.kind, destinationOf(answer)]),
    expected: [
      ['idle', undefined],
      ['idle', undefined],
      ['moved', '/onboarding'],
    ],
  });
});
