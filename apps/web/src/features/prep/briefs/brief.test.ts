import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  briefTime,
  contentionWords,
  framingWords,
  responseCount,
  type Brief,
} from './brief';

setupRitewayBun();

const words = (n: number) => Array.from({ length: n }, () => 'w').join(' ');
const card = { cardId: 'c', title: 't', cite: 'x', words: 10 };
const brief: Brief = {
  id: 'b',
  title: 'T',
  side: 'aff',
  motion: 'm',
  visibility: { kind: 'private' },
  savedAt: '',
  framing: { motion: 'm', burden: words(20), cards: [card] },
  contentions: [
    {
      id: 'c1',
      tag: 't',
      claim: words(5),
      warrant: words(100),
      impact: words(15),
      cards: [card, card],
      responses: [{ say: 'a', we: 'b' }],
    },
    {
      id: 'c2',
      tag: 't',
      claim: '',
      warrant: words(50),
      impact: '',
      cards: [],
      responses: [
        { say: 'a', we: 'b' },
        { say: 'c', we: 'd' },
      ],
    },
  ],
};

describe('brief words', () => {
  test('framing, contentions and responses', () => {
    assert({
      given: 'a brief with a framing and two contentions',
      should: 'count spoken words and cards, and total the responses',
      actual: [
        framingWords(brief),
        contentionWords(brief.contentions[0]!),
        contentionWords(brief.contentions[1]!),
        responseCount(brief),
      ],
      expected: [30, 140, 50, 3],
    });
  });
});

describe('briefTime', () => {
  test('per section and as one speech, over the limit', () => {
    const time = briefTime(brief, 60, 200);
    assert({
      given: '220 words at 60 a minute against a 200 second limit',
      should: 'read 3:40, be 20 seconds over, and suggest trimming 20 words',
      actual: [
        time.sections.map((s) => [s.label, s.clock]),
        time.whole.clock,
        time.budget.over,
        time.overClock,
        time.trimWords,
      ],
      expected: [
        [
          ['Framing', '0:30'],
          ['Contention 1', '2:20'],
          ['Contention 2', '0:50'],
        ],
        '3:40',
        true,
        '0:20',
        20,
      ],
    });
  });

  test('under the limit', () => {
    const time = briefTime(brief, 60, 600);
    assert({
      given: 'a generous limit',
      should: 'not be over and suggest no trim',
      actual: [
        time.budget.over,
        time.overClock,
        time.trimWords,
        time.budget.percent,
      ],
      expected: [false, '0:00', 0, 37],
    });
  });
});
