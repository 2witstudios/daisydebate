import { assert, setupRitewayBun, test } from 'riteway/bun';

import { preparePractice, type PracticeCatalog } from './start-practice';
import { debater, judge } from './roster.test-support';

setupRitewayBun();

const catalog: PracticeCatalog = {
  bots: [debater('wren-actor-id-000000', { label: 'Wren' }), judge()],
  freestyle: { formatId: 'freestyle', formatVersion: 1, presetVersion: 1 },
};

const form = (bot: string) => {
  const data = new FormData();
  data.set('bot', bot);
  return data;
};

test('Start practice asks for a casual Freestyle Room with the chosen bot and the AI judge (DEC-269)', () => {
  const ready = preparePractice(
    form('wren-actor-id-000000'),
    catalog,
    'command-1',
  );
  assert({
    given: 'a chosen eligible opponent with the judge and format available',
    should:
      'build the create body: strike resolution, public, freestyle at its canonical preset, the bot at negative and the judge judging',
    actual:
      ready.kind === 'ready'
        ? [
            ready.body.title,
            ready.body.resolution,
            ready.body.visibility,
            ready.body.selection,
            ready.body.cast,
          ]
        : ready,
    expected: [
      'Practice vs Wren',
      { kind: 'strike' },
      'public',
      {
        kind: 'catalog',
        formatId: 'freestyle',
        formatVersion: 1,
        presetVersion: 1,
        competitionType: 'casual',
      },
      [
        { actorId: 'wren-actor-id-000000', role: 'negative', slot: 0 },
        { actorId: 'judge-actor-id-000000', role: 'judge', slot: 0 },
      ],
    ],
  });
});

test('Start practice refuses truthfully before any request', () => {
  const refusalOf = (
    bots: PracticeCatalog['bots'],
    bot: string,
    freestyle: PracticeCatalog['freestyle'] = catalog.freestyle,
  ) => preparePractice(form(bot), { bots, freestyle }, 'command-1');
  assert({
    given:
      'an unknown opponent, an ineligible roster, a missing judge and a missing format',
    should: 'refuse each with its own truthful message',
    actual: [
      refusalOf(catalog.bots, 'nobody').kind,
      refusalOf(
        [debater('wren-actor-id-000000', { eligible: false }), judge()],
        'wren-actor-id-000000',
      ).kind,
      refusalOf([debater('wren-actor-id-000000')], 'wren-actor-id-000000').kind,
      refusalOf(catalog.bots, 'wren-actor-id-000000', null).kind,
    ],
    expected: ['refused', 'refused', 'refused', 'refused'],
  });
});
