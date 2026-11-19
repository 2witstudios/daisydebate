import { assert, setupRitewayBun, test } from 'riteway/bun';
import { noLadderReason } from '../play/ladder-division-words';
import {
  challengeModeLine,
  challengeSummary,
  mayChallenge,
  offersRanked,
} from './challenge-lobby';

setupRitewayBun();

test('mayChallenge', () => {
  assert({
    given: 'members of one lobby, of the other, and one with no age record',
    should: 'offer a challenge inside one lobby only; no record browses Open',
    actual: [
      mayChallenge('youth', 'youth'),
      mayChallenge('open', 'open'),
      mayChallenge('open', 'youth'),
      mayChallenge('youth', 'open'),
      mayChallenge(null, 'open'),
      mayChallenge(null, 'youth'),
    ],
    expected: [true, true, false, false, true, false],
  });
});

test('offersRanked', () => {
  assert({
    given:
      'two members of one division, and a pair where one has no age record',
    should: 'offer Ranked only when both hold the same division',
    actual: [
      offersRanked('youth', 'youth'),
      offersRanked(null, 'open'),
      offersRanked('open', null),
    ],
    expected: [true, false, false],
  });
});

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
