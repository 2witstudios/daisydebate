import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { roomPanelView } from './room-panel';
import { parseRoomPanelQuery } from './room-panel-query';

setupRitewayBun();

const now = '2026-09-30T12:00:00.000Z';
const view = (params: Record<string, string>) =>
  roomPanelView(parseRoomPanelQuery(params), 160, now);

describe('roomPanelView', () => {
  test('before a case is chosen', () => {
    const v = view({});
    assert({
      given: 'nothing pinned',
      should:
        'ask which case to bring, offering every case at its newest version',
      actual: [
        v.body.kind,
        v.body.kind === 'choose' ? v.body.options : null,
        v.summary,
      ],
      expected: [
        'choose',
        [
          { value: 'aff-rights', label: 'Affirmative, rights-based (v4)' },
          { value: 'neg-costs-first', label: 'Negative, costs first (v2)' },
        ],
        'No case attached',
      ],
    });
  });

  test('search only', () => {
    const v = view({ pin: 'none', q: 'pilot' });
    assert({
      given: 'continuing without prep and searching',
      should: 'offer search with results',
      actual: [
        v.body.kind,
        v.body.kind === 'search-only'
          ? v.body.search.results.map((r) => r.id)
          : null,
      ],
      expected: ['search-only', ['pilot-results']],
    });
  });

  test('a pinned case on the speech tab', () => {
    const v = view({ pin: 'aff-rights' });
    const b = v.body;
    assert({
      given: 'the case pinned at its newest version',
      should:
        'show the first speech checklist, the claim, the next card and no notice',
      actual:
        b.kind === 'pinned' && b.body.kind === 'tabs'
          ? [
              b.version,
              b.notice,
              b.body.speech.rows.map((r) => [r.label, r.clock, r.current]),
              b.body.speech.claim,
              b.body.speech.nextCard,
              v.summary,
            ]
          : null,
      expected: [
        4,
        null,
        [
          ['Framing', '1:08', false],
          ['Contention 1', '2:45', true],
          ['Contention 2', '2:23', false],
        ],
        '[Claim: one sentence the judge can write on the flow.]',
        null,
        'Now: [Speech 1]',
      ],
    });
  });

  test('a case changed elsewhere, and keeping the pinned version', () => {
    const stale = view({ pin: 'aff-rights', v: '3' });
    const kept = view({ pin: 'aff-rights', v: '3', keep: '1' });
    assert({
      given: 'a debate pinned to v3 while v4 exists',
      should: 'offer to switch to v4 or keep v3, and stay quiet once kept',
      actual: [
        stale.body.kind === 'pinned' ? stale.body.notice?.title : null,
        stale.body.kind === 'pinned'
          ? stale.body.notice?.actions.map((a) => a.href)
          : null,
        kept.body.kind === 'pinned' ? kept.body.notice : 'x',
      ],
      expected: [
        'This case changed elsewhere',
        [
          '/prep/in-debate?pin=aff-rights&v=4',
          '/prep/in-debate?pin=aff-rights&v=3&keep=1',
        ],
        null,
      ],
    });
  });

  test('cards in the case, and reading one', () => {
    const tabs = view({ pin: 'aff-rights', tab: 'cards' });
    const reading = view({
      pin: 'aff-rights',
      card: 'pilot-results',
      send: '1',
    });
    assert({
      given: 'the cards tab, and a card open with Send asking',
      should:
        'list the case’s card, and show the card with the send confirmation',
      actual: [
        tabs.body.kind === 'pinned' && tabs.body.body.kind === 'tabs'
          ? tabs.body.body.cards.map((c) => c.meta)
          : null,
        reading.body.kind === 'pinned' && reading.body.body.kind === 'card'
          ? [
              reading.body.body.card.id,
              reading.body.body.sendAsk,
              reading.body.body.backHref,
            ]
          : null,
        reading.summary,
      ],
      expected: [
        ['[Author B] [year] · 0:10'],
        ['pilot-results', true, '/prep/in-debate?pin=aff-rights'],
        'Reading a card',
      ],
    });
  });

  test('phone and hide links', () => {
    const v = view({ pin: 'aff-rights', open: '1' });
    assert({
      given: 'the phone sheet open',
      should: 'link closing, hiding and showing',
      actual: [v.closeHref, v.hideHref, v.openHref],
      expected: [
        '/prep/in-debate?pin=aff-rights',
        '/prep/in-debate?pin=aff-rights&open=1&hide=1',
        '/prep/in-debate?pin=aff-rights&open=1',
      ],
    });
  });

  test('an unknown case falls back to choosing', () => {
    assert({
      given: 'a pin that is no case',
      should: 'ask again',
      actual: view({ pin: 'nope' }).body.kind,
      expected: 'choose',
    });
  });
});
