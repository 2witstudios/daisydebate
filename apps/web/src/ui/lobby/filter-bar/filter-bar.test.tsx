import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { defaultQuery, type LobbyQuery } from '../../../features/lobby/query';
import { FilterBar } from './filter-bar';
import {
  controlClass,
  dividerClass,
  filterBarClass,
  panelClass,
  summaryClass,
} from './filter-bar-class';

setupRitewayBun();

const counts = { all: 8, open: 5, live: 3 };
const render = (query: LobbyQuery, resultCount = 8) =>
  renderToString(h(FilterBar, { query, counts, resultCount }));

describe('FilterBar form contract', () => {
  test('a real GET form to the lobby', () => {
    const html = render(defaultQuery);
    assert({
      given: 'the default query',
      should: 'be a search-landmark GET form with no client-only submit',
      actual: [
        /<form [^>]*method="get"/.test(html),
        /<form [^>]*action="\/lobby"/.test(html),
        /<form [^>]*role="search"/.test(html),
        /<button type="submit"[^>]*>Apply<\/button>/.test(html),
        html.includes('onChange'),
      ],
      expected: [true, true, true, true, false],
    });
  });

  test('every URL parameter has a named control', () => {
    const html = render(defaultQuery);
    const names = [...html.matchAll(/<(?:input|select) [^>]*name="(\w+)"/g)]
      .map((match) => match[1])
      .filter((name, index, all) => all.indexOf(name) === index)
      .sort();
    assert({
      given: 'the filter form',
      should: 'submit tab, q, mode, format, range and sort',
      actual: names,
      expected: ['format', 'mode', 'q', 'range', 'sort', 'tab'],
    });
  });

  test('current values are preselected', () => {
    const html = render({
      tab: 'live',
      mode: 'casual',
      q: 'spar',
      format: 'public-forum',
      range: 200,
      sort: 'watched',
    });
    assert({
      given: 'a filtered query',
      should: 'put each value back in its control',
      actual: [
        /name="tab" value="live"/.test(html),
        /value="spar"/.test(html),
        /<option value="public-forum" selected=""/.test(html),
        /<option value="200" selected=""/.test(html),
        /<option value="watched" selected=""/.test(html),
        /value="casual"[^>]*checked=""|checked=""[^>]*value="casual"/.test(
          html,
        ),
      ],
      expected: [true, true, true, true, true, true],
    });
  });

  test('the panel is a details element', () => {
    const html = render(defaultQuery);
    assert({
      given: 'the default query',
      should:
        'render the phone panel as a closed details with a Filters summary',
      actual: [
        /<details [^>]*class="contents details-content:contents/.test(html),
        html.includes('<details') && !/<details [^>]*open/.test(html),
        /<summary [^>]*>.*Filters/.test(html),
      ],
      expected: [true, true, true],
    });
  });

  test('the Filters badge and Clear link', () => {
    const plain = render(defaultQuery);
    const filtered = render({ ...defaultQuery, mode: 'ranked', range: 100 });
    assert({
      given: 'no filters and two panel filters',
      should: 'show the count badge and a Clear link only when filtered',
      actual: [
        plain.includes('>Clear<'),
        filtered.includes('>Clear<'),
        />2<\/span><\/summary>/.test(filtered),
        />\d<\/span><\/summary>/.test(plain),
      ],
      expected: [false, true, true, false],
    });
  });

  test('the phone results line', () => {
    assert({
      given: 'one and many results',
      should: 'say room or rooms',
      actual: [render(defaultQuery, 1), render(defaultQuery, 5)].map((html) =>
        /(\d) (rooms?)</.exec(html)?.slice(1, 3).join(' '),
      ),
      expected: ['1 room', '5 rooms'],
    });
  });
});

describe('filter bar classes', () => {
  test('layout', () => {
    assert({
      given: 'the filter bar class strings',
      should: 'keep the desktop rows and the phone panel literal',
      actual: [
        filterBarClass,
        controlClass,
        dividerClass,
        summaryClass,
        panelClass,
      ],
      expected: [
        'flex flex-wrap items-center gap-x-3 gap-y-4',
        'h-10 min-w-0 rounded-md border border-border bg-surface-raised px-3 text-base text-ink max-compact:h-12',
        'order-3 -mt-4 h-px basis-full bg-border max-compact:order-2',
        'hidden h-12 cursor-pointer items-center gap-2 rounded-md border border-border bg-surface-raised px-3 text-base font-strong text-ink max-compact:order-4 max-compact:flex',
        'details-content:contents max-compact:details-content:order-6 max-compact:details-content:flex max-compact:details-content:basis-full max-compact:details-content:flex-col max-compact:details-content:gap-3 max-compact:details-content:rounded-lg max-compact:details-content:border max-compact:details-content:border-border max-compact:details-content:bg-surface max-compact:details-content:p-3',
      ],
    });
  });
});
