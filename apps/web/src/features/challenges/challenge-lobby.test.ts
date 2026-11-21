import { assert, setupRitewayBun, test } from 'riteway/bun';
import { noLadderReason } from '../play/ladder-division-words';
import { challengeModeLine, challengeSummary } from './challenge-lobby';

setupRitewayBun();

test('challengeModeLine', () => {
  assert({
    given: 'a viewer with a division, and one with no age record',
    should: 'say nothing, then reuse the age prompt',
    actual: [challengeModeLine('open'), challengeModeLine(null)],
    expected: [null, noLadderReason],
  });
});

test('challengeSummary', () => {
  assert({
    given: 'a ranked and a casual Freestyle offer',
    should: 'name the style and mode, never a division',
    actual: [
      challengeSummary({ mode: 'ranked', format: 'freestyle' }),
      challengeSummary({ mode: 'casual', format: 'freestyle' }),
    ],
    expected: ['Freestyle · Ranked', 'Freestyle · Casual'],
  });
});
