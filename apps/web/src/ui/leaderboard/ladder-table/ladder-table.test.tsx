import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { defaultQuery } from '../../../features/leaderboard/query';
import {
  field,
  ladder,
} from '../../../features/leaderboard/ladder.test-support';
import { LadderTable } from './ladder-table';

setupRitewayBun();

const render = (...args: Parameters<typeof ladder>) => {
  const view = ladder(...args);
  return renderToString(
    h(LadderTable, { view, query: { ...defaultQuery, ...args[1] } }),
  );
};

describe('LadderTable', () => {
  test('first page', () => {
    const html = render(field(40));
    assert({
      given: 'forty debaters on the first page',
      should: 'show the podium, twelve rows, the pager with Next only',
      actual: [
        html.includes('aria-label="Top three"'),
        html.match(/<li /g)?.length,
        html.includes('href="/leaderboard?page=2"'),
        html.includes('Page 1 of 3'),
        html.match(/aria-disabled="true"/g)?.length,
      ],
      expected: [true, 3 + 12, true, true, 1],
    });
  });

  test('last page', () => {
    const html = render(field(40), { page: 3 });
    assert({
      given: 'the last page',
      should: 'link to the previous page and disable Next',
      actual: [
        html.includes('href="/leaderboard?page=2"'),
        html.includes('rel="prev"'),
        html.includes('rel="next"'),
        html.includes('aria-label="Top three"'),
      ],
      expected: [true, true, false, false],
    });
  });

  test('column head depends on the season', () => {
    assert({
      given: 'a live season',
      should: 'head the movement column 7 days',
      actual: render(field(12)).includes('7 days'),
      expected: true,
    });
  });

  test('empty', () => {
    const html = render(field(12), { q: 'zzz' });
    assert({
      given: 'a search nobody matches',
      should: 'show the empty state with Clear filters and no pager links',
      actual: [
        html.includes('No matches'),
        html.includes('href="/leaderboard"'),
        html.includes('0 debaters'),
      ],
      expected: [true, true, true],
    });
  });

  test('around me', () => {
    const view = ladder(
      [...field(30)],
      { scope: 'around' },
      { username: 'p010', blinded: [] },
    );
    const html = renderToString(
      h(LadderTable, { view, query: { ...defaultQuery, scope: 'around' } }),
    );
    assert({
      given: 'the around-me window',
      should: 'show the rank range note and no pager links',
      actual: [
        html.includes('Ranks 6 to 16'),
        html.includes('aria-label="Pages"'),
      ],
      expected: [true, false],
    });
  });
});
