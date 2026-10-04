import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { listMyDebates } from '../../../features/debates/list-my-debates';
import {
  parseDebatesQuery,
  type DebatesQuery,
} from '../../../features/debates/list';
import { DebatesPage } from './debates-page';

setupRitewayBun();

const now = '2026-10-03T12:00:00.000Z';
const render = (query: DebatesQuery) =>
  renderToString(
    h(DebatesPage, { listing: listMyDebates(query, now), query, now }),
  );

describe('DebatesPage', () => {
  test('the first page', () => {
    const html = render(parseDebatesQuery({}));
    assert({
      given: 'the whole history',
      should:
        'show one h1, five rows with results, the tabs with counts and a next link',
      actual: [
        html.match(/<h1 /g)?.length,
        (html.match(/<li class="flex flex-wrap/g) ?? []).length,
        html.includes('aria-current="page"'),
        html.includes('Placeholder AI judge'),
        html.includes('Judge assigned by Daisy'),
        html.includes('href="/debates?page=2"'),
        html.includes('href="/recordings/evening-round"'),
      ],
      expected: [1, 5, true, true, true, true, true],
    });
  });

  test('ranked results carry a rating change', () => {
    const html = render(parseDebatesQuery({ tab: 'ranked' }));
    assert({
      given: 'the ranked tab',
      should: 'show rating changes with their signs and only ranked rows',
      actual: [
        html.includes('+9'),
        html.includes('-14'),
        html.includes('Evening round'),
      ],
      expected: [true, true, false],
    });
  });

  test('an empty tab', () => {
    const html = renderToString(
      h(DebatesPage, {
        listing: {
          rows: [],
          counts: { all: 0, won: 0, lost: 0, ranked: 0, practice: 0 },
          page: 1,
          pageCount: 1,
        },
        query: parseDebatesQuery({}),
        now,
      }),
    );
    assert({
      given: 'no debates at all',
      should: 'say so and offer the lobby',
      actual: [
        html.includes('No debates here yet'),
        html.includes('href="/lobby"'),
        html.includes('aria-label="Pages"'),
      ],
      expected: [true, true, false],
    });
  });
});
