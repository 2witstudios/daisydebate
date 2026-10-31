import { assert, setupRitewayBun, test } from 'riteway/bun';

import { opponents, practiceJudge, trainLanding } from './bots';
import { debater, judge } from './roster.test-support';

setupRitewayBun();

const roster = [
  debater('wren-actor-id-000000', {
    label: 'Wren',
    persona: 'Quick and dry',
    difficulty: 'intermediate',
  }),
  debater('juno-actor-id-000000', {
    label: 'Juno',
    persona: 'Warm and loud',
    difficulty: 'beginner',
  }),
  judge(),
];

test('Train reads its opponents and judge from the one roster (train-room)', () => {
  assert({
    given: 'the authenticated cast read',
    should:
      'oppose only bot debaters and judge only with the AI judge (ISSUE-750)',
    actual: [
      opponents(roster).map((bot) => bot.seatRole),
      practiceJudge(roster)?.seatRole ?? null,
    ],
    expected: [['debater', 'debater'], 'judge'],
  });
});

test('Train selects the addressed opponent and reports availability truthfully', () => {
  const landing = (params: Record<string, string>, bots = roster) =>
    trainLanding(params as never, bots);
  assert({
    given: 'no address, another address, and AI off',
    should:
      'default to the first opponent, honour the address, and mark the landing unavailable',
    actual: [
      landing({})['chosen']?.actorId,
      landing({ bot: 'juno-actor-id-000000' })['chosen']?.actorId,
      landing({ bot: 'unknown' })['chosen']?.actorId,
      landing({}, [
        debater('wren-actor-id-000000', { eligible: false }),
        judge({ eligible: false }),
      ])['available'],
    ],
    expected: [
      'wren-actor-id-000000',
      'juno-actor-id-000000',
      'wren-actor-id-000000',
      false,
    ],
  });
  assert({
    given: 'a roster without an eligible judge',
    should: 'keep the landing unavailable even with an eligible opponent',
    actual: landing({}, [
      debater('wren-actor-id-000000'),
      judge({ eligible: false }),
    ])['available'],
    expected: false,
  });
});

test('every opponent card is an address link that works without JavaScript', () => {
  const landing = trainLanding(
    { bot: 'juno-actor-id-000000' } as never,
    roster,
  );
  assert({
    given: 'the chosen card and its neighbours',
    should: 'carry each card href and the selected mark',
    actual: landing.opponents.map((card) => [card.actorId, card.selected]),
    expected: [
      ['wren-actor-id-000000', false],
      ['juno-actor-id-000000', true],
    ],
  });
});
