import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { defaultQuery } from '../../../features/leaderboard/query';
import {
  activeSeason,
  closedSeason,
} from '../../../features/leaderboard/ladder.test-support';
import { LadderFilters, type LadderFiltersProps } from './ladder-filters';

setupRitewayBun();

const render = (props: Partial<LadderFiltersProps> = {}) =>
  renderToString(
    h(LadderFilters, {
      query: defaultQuery,
      seasons: [activeSeason, closedSeason],
      season: activeSeason,
      hasStanding: true,
      ...props,
    }),
  ).replace(/<!-- -->/g, '');

describe('LadderFilters', () => {
  test('one GET form to the ladder', () => {
    const html = render();
    assert({
      given: 'the default query',
      should:
        'be a search-role GET form with search, season, status, band, region and Apply',
      actual: [
        html.includes('action="/leaderboard"'),
        html.includes('method="get"'),
        html.includes('role="search"'),
        html.includes('aria-label="Search for a debater"'),
        html.includes('name="season"'),
        html.includes('name="status"'),
        html.includes('name="band"'),
        html.includes('name="region"'),
        html.includes('>Apply<'),
        html.includes('Clear'),
      ],
      expected: [true, true, true, true, true, true, true, true, true, false],
    });
  });

  test('options', () => {
    const html = render();
    assert({
      given: 'two seasons',
      should: 'label current and closed, list bands high to low',
      actual: [
        html.includes('Season 5 (current)'),
        html.includes('Season 4 (closed)'),
        html.indexOf('Full bloom') < html.indexOf('Sprout'),
        html.includes('Africa and Middle East'),
      ],
      expected: [true, true, true, true],
    });
  });

  test('scope links need a standing', () => {
    assert({
      given: 'a viewer with and without a line',
      should: 'show the scope links only with one',
      actual: [
        render().includes('Around me'),
        render({ hasStanding: false }).includes('Around me'),
      ],
      expected: [true, false],
    });
  });

  test('active filters', () => {
    const html = render({
      query: {
        ...defaultQuery,
        scope: 'around',
        status: 'everyone',
        band: 'bud',
        q: 'x',
      },
    });
    assert({
      given: 'filters set and the around-me scope',
      should: 'count two in the phone panel, carry scope and offer Clear',
      actual: [
        html.includes('name="scope" value="around"'),
        html.includes('>2<'),
        html.includes('Clear'),
        html.includes('href="/leaderboard?scope=around"'),
      ],
      expected: [true, true, true, true],
    });
  });
});
