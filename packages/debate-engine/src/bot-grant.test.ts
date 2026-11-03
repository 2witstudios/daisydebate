import { assert, setupRitewayBun, test } from 'riteway/bun';
import { botGrantUnused } from './bot-grant';

setupRitewayBun();
const seat = { kind: 'bot', role: 'negative', slot: 0 } as const;
const theirTurn = { side: 'negative', slot: 0 };
const otherTurn = { side: 'affirmative', slot: 0 };

test('whether a bot owes a stream for a grant (ISSUE-965)', () => {
  const cases = [
    [
      'another seat’s turn, nothing published',
      { seat, turn: otherTurn, hasCreditedWindow: false },
      true,
    ],
    [
      'another slot on its side',
      { seat, turn: { side: 'negative', slot: 1 }, hasCreditedWindow: false },
      true,
    ],
    [
      'its own scheduled turn',
      { seat, turn: theirTurn, hasCreditedWindow: false },
      false,
    ],
    [
      'another seat’s turn with a credited window',
      { seat, turn: otherTurn, hasCreditedWindow: true },
      false,
    ],
    [
      'a segment the rules cannot name',
      { seat, turn: undefined, hasCreditedWindow: false },
      false,
    ],
    [
      'a rule naming neither side nor slot',
      { seat, turn: {}, hasCreditedWindow: false },
      false,
    ],
    [
      'a human in another seat’s turn',
      {
        seat: { ...seat, kind: 'human' },
        turn: otherTurn,
        hasCreditedWindow: false,
      },
      false,
    ],
  ] as const;
  for (const [given, facts, expected] of cases)
    assert({
      given,
      should: expected ? 'owe no stream' : 'stay owed',
      actual: botGrantUnused(facts),
      expected,
    });
});
