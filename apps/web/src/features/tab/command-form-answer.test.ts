import { assert, setupRitewayBun, test } from 'riteway/bun';
import { mapTabCommandAnswer } from './command-form-answer';

setupRitewayBun();

test('pending replies follow the contract used by the form', () => {
  const outcomes = {
    accepted: () => 'accepted',
    refused: () => 'refused',
    unacknowledged: () => 'unacknowledged',
  };
  const pending = {
    kind: 'pending',
    pendingCommandId: 'legacy-id',
    expiresAt: 'legacy-expiry',
  };
  const acceptedPending = () => 'pending';
  assert({
    given:
      'an older pending reply with noncanonical but string-valued metadata',
    should: 'acknowledge it only for a People command',
    actual: [
      mapTabCommandAnswer(pending, outcomes),
      mapTabCommandAnswer(pending, {
        ...outcomes,
        pending: { contract: 'draw', answer: acceptedPending },
      }),
      mapTabCommandAnswer(pending, {
        ...outcomes,
        pending: { contract: 'people', answer: acceptedPending },
      }),
    ],
    expected: ['unacknowledged', 'unacknowledged', 'pending'],
  });
});
