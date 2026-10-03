import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { roomPanelView } from '../../../features/prep/room-panel';
import { parseRoomPanelQuery } from '../../../features/prep/room-panel-query';
import { InDebatePage } from './in-debate-page';

setupRitewayBun();

const render = (params: Record<string, string> = {}) =>
  renderToString(
    h(InDebatePage, {
      view: roomPanelView(
        parseRoomPanelQuery(params),
        160,
        '2026-09-30T12:04:00.000Z',
      ),
      loadedAt: '12:04',
    }),
  );

describe('InDebatePage before a case', () => {
  const html = render();
  test('asks which case to bring, as a GET form', () => {
    assert({
      given: 'no case pinned',
      should:
        'show the privacy assurance, the Only you badge, the picker form and a way to go without',
      actual: [
        html.includes('aria-label="Your prep"'),
        html.includes('Only you'),
        html.includes('cannot see this panel or what you open in it'),
        html.includes('No case attached'),
        /<form [^>]*action="\/prep\/in-debate"[^>]*method="get"/.test(html) ||
          /<form [^>]*method="get"[^>]*action="\/prep\/in-debate"/.test(html),
        html.includes('Bring to this debate'),
        html.includes('href="/prep/in-debate?pin=none"'),
        html.includes('Read only here. Edit your prep after the debate.'),
      ],
      expected: [true, true, true, true, true, true, true, true],
    });
  });

  test('the room is context only', () => {
    assert({
      given: 'the room beside the panel',
      should: 'use sample values and never say standard rules or a format',
      actual: [
        html.includes('Room stage shown for context, with sample values.'),
        html.includes('[speech time]'),
        /Standard rules|Lincoln|Public Forum|Parliamentary/.test(html),
      ],
      expected: [true, true, false],
    });
  });
});

describe('InDebatePage with a case', () => {
  test('the speech tab', () => {
    const html = render({ pin: 'aff-rights' });
    assert({
      given: 'the case pinned',
      should:
        'name the pin, tab Speech Cards Search, list the checklist with times and keep ticks page-local',
      actual: [
        html.includes('v4 · pinned for this debate'),
        html.includes('href="/prep/in-debate?pin=aff-rights&amp;tab=cards"'),
        html.match(/type="checkbox"/g)?.length,
        html.includes('>2:45<'),
        html.includes('Ticks stay on this page only.'),
        html.includes('Now: [Speech 1]'),
      ],
      expected: [true, true, 3, true, true, true],
    });
  });

  test('reading a card and sending it', () => {
    const reading = render({ pin: 'aff-rights', card: 'pilot-results' });
    const asking = render({
      pin: 'aff-rights',
      card: 'pilot-results',
      send: '1',
    });
    assert({
      given: 'a card open, then Send to room asking',
      should:
        'mark it read only, ask before sending exactly one card, and answer Send card as a sample action',
      actual: [
        reading.includes('Read only'),
        reading.includes('Send this card to the room?'),
        asking.includes('Send this card to the room?'),
        asking.includes(
          'Your opponent and the judge will see this one card and its citation.',
        ),
        asking.includes('href="?did=Send+card"'),
        asking.includes('>Cancel<'),
      ],
      expected: [true, false, true, true, true, true],
    });
  });

  test('the case changed elsewhere', () => {
    const html = render({ pin: 'aff-rights', v: '3' });
    assert({
      given: 'pinned to v3 while v4 exists',
      should: 'keep v3 and offer to switch',
      actual: [
        html.includes('This case changed elsewhere'),
        html.includes('Switch to v4'),
        html.includes('Keep v3'),
        html.includes('v3 · pinned for this debate'),
      ],
      expected: [true, true, true, true],
    });
  });

  test('searching your library', () => {
    const html = render({ pin: 'aff-rights', tab: 'search', q: 'cost' });
    assert({
      given: 'a search on the search tab',
      should: 'show read-only results and say nothing is sent to the room',
      actual: [
        html.includes('Nothing you type is sent to the room.'),
        html.includes('Cost estimates depend on assumed take-up'),
        html.includes('card=cost-estimates'),
      ],
      expected: [true, true, true],
    });
  });
});

describe('InDebatePage on the phone and hidden', () => {
  test('collapsed shows a summary bar; open shows a sheet and a scrim', () => {
    const closed = render({ pin: 'aff-rights' });
    const open = render({ pin: 'aff-rights', open: '1' });
    assert({
      given: 'the sheet collapsed and then open',
      should:
        'show the summary with Open, then the sheet over a scrim without the bar',
      actual: [
        closed.includes('href="/prep/in-debate?pin=aff-rights&amp;open=1"'),
        closed.includes('bg-scrim'),
        open.includes('bg-scrim'),
        open.includes('max-compact:fixed'),
        open.match(/aria-label="Your prep"/g)?.length,
      ],
      expected: [true, false, true, true, 1],
    });
  });

  test('hidden panel leaves a way back', () => {
    const html = render({ pin: 'aff-rights', hide: '1' });
    assert({
      given: 'the panel hidden',
      should: 'offer Show prep',
      actual: [
        html.includes('Show prep'),
        html.includes('href="/prep/in-debate?pin=aff-rights"'),
      ],
      expected: [true, true],
    });
  });

  test('searching without a case', () => {
    const html = render({ pin: 'none', q: 'pilot' });
    assert({
      given: 'continuing without prep and searching',
      should: 'show search results and a way to bring a case',
      actual: [
        html.includes('Pilot results do not transfer across regions'),
        html.includes('Bring a case'),
      ],
      expected: [true, true],
    });
  });
});
