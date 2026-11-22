import { assert, setupRitewayBun, test } from 'riteway/bun';
import { decisionRelease } from './decision-release';

setupRitewayBun();

const seat = (
  actorId: string,
  userId: string | null,
  side: string | null,
  slot: number,
  sideOrder: number | null,
  current = true,
  erased = false,
) => ({
  actorId,
  userId,
  side,
  slot,
  sideOrder,
  current,
  erased,
  kind: side === null ? 'judge' : 'side',
});

test('held decisions owe no default notification', () => {
  assert({
    given: 'a held or missing Round policy and an on-finalize policy',
    should: 'release only the explicit on-finalize decision',
    actual: ['held', null, 'on_finalize'].map(decisionRelease.release),
    expected: [false, false, true],
  });
});

test('the default audience uses current live accounts and frozen side order', () => {
  const facts = [
    seat('aff0', 'a', 'affirmative', 0, 1),
    seat('aff1', 'b', 'affirmative', 1, 1),
    seat('neg0', 'c', 'negative', 0, 0),
    seat('neg1', 'd', 'negative', 1, 0),
    seat('judge', 'e', null, 0, null),
    seat('retired', 'f', null, 0, null, false),
    seat('erased', 'g', 'affirmative', 2, 1, true, true),
    seat('bot', null, 'negative', 2, 0),
  ];
  assert({
    given:
      'multiple seats, Negative declared first, a judge, retired and erased members and a bot',
    should:
      'tell each eligible account once about the first opposite-side seat, and the judge about the first declared side',
    actual: decisionRelease.audience(facts),
    expected: [
      { userId: 'a', about: 'neg0' },
      { userId: 'b', about: 'neg0' },
      { userId: 'c', about: 'aff0' },
      { userId: 'd', about: 'aff0' },
      { userId: 'e', about: 'neg0' },
    ],
  });
  assert({
    given: 'one live judge with nobody across from them',
    should: 'retain the existing self-about fallback',
    actual: decisionRelease.audience([seat('judge', 'e', null, 0, null)]),
    expected: [{ userId: 'e', about: 'judge' }],
  });
});

test('default audience retains first-seat precedence without changing its input', () => {
  const facts = Object.freeze([
    Object.freeze(seat('judge', 'same', null, 0, null)),
    Object.freeze(seat('human', 'same', 'negative', 0, 1)),
    Object.freeze(seat('bot', null, 'affirmative', 0, 0)),
  ]);
  assert({
    given: 'one account with multiple current seats and a bot across from it',
    should:
      'keep the first ordered seat and allow the bot as the about target without mutating facts',
    actual: [decisionRelease.audience(facts), facts.map((s) => s.actorId)],
    expected: [[{ userId: 'same', about: 'bot' }], ['judge', 'human', 'bot']],
  });
});
