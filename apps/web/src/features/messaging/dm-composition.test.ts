import { assert, setupRitewayBun, test } from 'riteway/bun';
import { dmRequestQuestion } from './dm-composition';

setupRitewayBun();

test('a DM request decision carries its answer', () => {
  assert({
    given: 'each step of a DM request',
    should:
      'ask the one decide capability with the answer given, so a decline stays a way out of a boundary',
    actual: (['read', 'accept', 'decline', 'cancel', 'result'] as const).map(
      dmRequestQuestion,
    ),
    expected: [
      { capability: 'channel.request.read' },
      { capability: 'channel.request.decide', answer: 'accept' },
      { capability: 'channel.request.decide', answer: 'decline' },
      { capability: 'channel.request.cancel' },
      { capability: 'channel.request.result' },
    ],
  });
});
