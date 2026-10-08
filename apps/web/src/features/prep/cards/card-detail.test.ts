import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { cardDetailView, cardHref, parseCardDetailQuery } from './card-detail';
import { getCard } from './get-card';

setupRitewayBun();

const card = (() => {
  const found = getCard('cost-estimates');
  if (found === undefined) throw new Error('missing sample card');
  return found;
})();

describe('parseCardDetailQuery', () => {
  test('defaults, values and junk', () => {
    assert({
      given: 'nothing, a view and version, and junk',
      should: 'parse or fall back',
      actual: [
        parseCardDetailQuery({}),
        parseCardDetailQuery({ view: 'full', version: '2' }),
        parseCardDetailQuery({ view: 'x', version: 'abc' }),
        parseCardDetailQuery({ version: '-4' }),
      ],
      expected: [
        { view: 'read', version: 0 },
        { view: 'full', version: 2 },
        { view: 'read', version: 0 },
        { view: 'read', version: 0 },
      ],
    });
  });

  test('hrefs', () => {
    assert({
      given: 'default and non-default state',
      should: 'carry only the non-defaults',
      actual: [
        cardHref('a', { view: 'read', version: 0 }),
        cardHref('a', { view: 'cite', version: 2 }),
      ],
      expected: ['/prep/cards/a', '/prep/cards/a?view=cite&version=2'],
    });
  });
});

describe('cardDetailView', () => {
  test('the current version', () => {
    const view = cardDetailView(card, { view: 'read', version: 0 }, 160);
    assert({
      given: 'the current version in the read view',
      should:
        'show v3 with no past-version banner, read time, tabs and versions',
      actual: [
        view.shown.version,
        view.pastVersion,
        view.readClock,
        view.tabs.map((tab) => tab.label),
        view.versionLinks.map((v) => [v.version, v.current]),
        view.readSegments.map((s) => s.text).filter((t) => t === '…').length,
      ],
      expected: [
        3,
        null,
        '0:10',
        ['Read view', 'Full source', 'Citation'],
        [
          [3, true],
          [2, false],
          [1, false],
        ],
        2,
      ],
    });
  });

  test('a past version', () => {
    const view = cardDetailView(card, { view: 'full', version: 2 }, 160);
    assert({
      given: 'version 2 in the full-source view',
      should: 'show v2, link back to current and keep the view in tab links',
      actual: [
        view.shown.version,
        view.pastVersion,
        view.tabs[0]?.href,
        view.versionLinks[0]?.href,
      ],
      expected: [
        2,
        { version: 2, currentHref: '/prep/cards/cost-estimates?view=full' },
        '/prep/cards/cost-estimates?version=2',
        '/prep/cards/cost-estimates?view=full',
      ],
    });
  });

  test('an unknown version falls back to current', () => {
    assert({
      given: 'a version the card does not have',
      should: 'show the current version',
      actual: cardDetailView(card, { view: 'read', version: 9 }, 160).shown
        .version,
      expected: 3,
    });
  });

  test('provenance and uses', () => {
    const view = cardDetailView(card, { view: 'read', version: 0 }, 160);
    assert({
      given: 'the sample card',
      should: 'list provenance rows and three uses',
      actual: [
        view.provenance.map(([term]) => term),
        view.uses.length,
        view.deleteHref,
      ],
      expected: [
        ['Author', 'Publication', 'Title', 'Published', 'Retrieved'],
        3,
        '/prep/cards/cost-estimates/delete',
      ],
    });
  });
});
