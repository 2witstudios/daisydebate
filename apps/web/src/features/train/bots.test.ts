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

const freestyle = {
  formatId: 'freestyle',
  label: 'Freestyle',
  formatVersion: 1,
  preset: { version: 1 },
};
const policy = {
  formatId: 'policy',
  label: 'Policy',
  formatVersion: 1,
  preset: { version: 2 },
};

const landing = (
  params: Record<string, string> = {},
  formats = [freestyle, policy],
  bots = roster,
) => trainLanding(params as never, bots, true, formats as never);

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
  assert({
    given: 'no address, another address, and AI off',
    should:
      'default to the first opponent, honour the address, and mark the landing unavailable',
    actual: [
      landing()['chosen']?.actorId,
      landing({ bot: 'juno-actor-id-000000' })['chosen']?.actorId,
      landing({ bot: 'unknown' })['chosen']?.actorId,
      landing(
        {},
        [freestyle, policy],
        [
          debater('wren-actor-id-000000', { eligible: false }),
          judge({ eligible: false }),
        ],
      )['available'],
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
    actual: landing(
      {},
      [freestyle, policy],
      [debater('wren-actor-id-000000'), judge({ eligible: false })],
    )['available'],
    expected: false,
  });
});

test('every opponent card is an address link that works without JavaScript', () => {
  const view = landing({ bot: 'juno-actor-id-000000' });
  assert({
    given: 'the chosen card and its neighbours',
    should: 'carry each card href and the selected mark',
    actual: view.opponents.map((card) => [card.actorId, card.selected]),
    expected: [
      ['wren-actor-id-000000', false],
      ['juno-actor-id-000000', true],
    ],
  });
  assert({
    given: 'the offered formats',
    should:
      'default to Freestyle and carry the chosen bot in every format href',
    actual: view.formats.map((format) => [
      format.id,
      format.selected,
      format.href,
    ]),
    expected: [
      ['freestyle', true, '/train?bot=juno-actor-id-000000'],
      ['policy', false, '/train?bot=juno-actor-id-000000&format=policy'],
    ],
  });
});

test('the addressed format rides the address and keeps the opponent', () => {
  const view = landing({ bot: 'juno-actor-id-000000', format: 'policy' });
  assert({
    given: 'a Policy address with a chosen opponent',
    should:
      'select Policy, keep the opponent selected, and point the opponent card back at Policy',
    actual: [
      view.formats.map((format) => format.selected),
      view.chosen?.actorId,
      view.chosen?.href,
    ],
    expected: [[false, true], 'juno-actor-id-000000', '/train?format=policy'],
  });
  assert({
    given: 'an unknown format address',
    should: 'fall back to Freestyle',
    actual: landing({ format: 'parli' }).formats.map(
      (format) => format.selected,
    ),
    expected: [true, false],
  });
});
