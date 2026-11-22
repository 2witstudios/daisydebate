import { assert, setupRitewayBun, test } from 'riteway/bun';
import { sideSeat } from '@daisy/protocol/seats';
import { botGrantUnused } from './bot-grant';

setupRitewayBun();
const seat = { kind: 'bot', seat: sideSeat('negative', 0) } as const;
const theirTurn = { lead: sideSeat('negative', 0) };
const otherTurn = { lead: sideSeat('affirmative', 0) };

test('whether a bot owes a stream for a grant (ISSUE-965)', () => {
  const cases = [
    [
      'another seat’s turn, nothing authored',
      { seat, turn: otherTurn, hasAuthoredSpeech: false },
      true,
    ],
    [
      'another slot on its side',
      {
        seat,
        turn: { lead: sideSeat('negative', 1) },
        hasAuthoredSpeech: false,
      },
      true,
    ],
    [
      'its own scheduled turn',
      { seat, turn: theirTurn, hasAuthoredSpeech: false },
      false,
    ],
    [
      'another seat’s turn with authored speech',
      { seat, turn: otherTurn, hasAuthoredSpeech: true },
      false,
    ],
    [
      'a segment the rules cannot name',
      { seat, turn: undefined, hasAuthoredSpeech: false },
      false,
    ],
    [
      'a rule naming no lead seat',
      { seat, turn: { lead: null }, hasAuthoredSpeech: false },
      false,
    ],
    [
      'a human in another seat’s turn',
      {
        seat: { ...seat, kind: 'human' },
        turn: otherTurn,
        hasAuthoredSpeech: false,
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
