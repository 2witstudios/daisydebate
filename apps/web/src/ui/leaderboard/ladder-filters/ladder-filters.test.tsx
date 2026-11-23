import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { defaultQuery } from '../../../features/leaderboard/query';
import {
  activeSeason,
  closedSeason,
} from '../../../features/leaderboard/ladder.test-support';
import {
  renderAccessible,
  type AccessibleView,
} from '../../../test-support/rendered/accessible';
import { LadderFilters, type LadderFiltersProps } from './ladder-filters';

setupRitewayBun();

const render = (props: Partial<LadderFiltersProps> = {}) =>
  renderAccessible(
    h(LadderFilters, {
      query: defaultQuery,
      ladder: { style: 'freestyle', division: 'open' },
      seasons: [activeSeason, closedSeason],
      season: activeSeason,
      hasStanding: true,
      ...props,
    }),
  );

const form = (view: AccessibleView) =>
  view.get('search', 'Filter the ladder') as HTMLFormElement;

/** The value the ladder form submits for one field, or null when it has none. */
const field = (view: AccessibleView, name: string) =>
  (form(view).elements.namedItem(name) as HTMLInputElement | null)?.value ??
  null;

/** Whether a piece of the form reads exactly this text. */
const shows = (view: AccessibleView, text: string) =>
  view.all('generic').some((element) => element.textContent === text);

describe('LadderFilters', () => {
  test('one GET form to the ladder', () => {
    const view = render();
    assert({
      given: 'the default query',
      should:
        'be a search-role GET form with search, season, status and Apply, and no band or region',
      actual: [
        form(view).getAttribute('action'),
        form(view).getAttribute('method'),
        view.attribute('searchbox', 'Search for a debater', 'name'),
        view.attribute('combobox', 'Season', 'name'),
        view.attribute('combobox', 'Status', 'name'),
        field(view, 'band'),
        field(view, 'region'),
        view.has('button', 'Apply'),
        view.textContent().includes('Clear'),
      ],
      expected: [
        '/leaderboard',
        'get',
        'q',
        'season',
        'status',
        null,
        null,
        true,
        false,
      ],
    });
  });

  test('options', () => {
    const view = render();
    assert({
      given: 'two seasons',
      should: 'label current and closed, and list no bands or regions',
      actual: [
        view.within('combobox', 'Season').names('option'),
        view.textContent().includes('Full bloom'),
        view.textContent().includes('Africa and Middle East'),
      ],
      expected: [['Season 5 (current)', 'Season 4 (closed)'], false, false],
    });
  });

  test('scope links need a standing', () => {
    assert({
      given: 'a viewer with and without a line',
      should: 'show the scope links only with one',
      actual: [
        render().has('link', 'Around me'),
        render({ hasStanding: false }).textContent().includes('Around me'),
      ],
      expected: [true, false],
    });
  });

  test('active filters', () => {
    const view = render({
      query: {
        ...defaultQuery,
        scope: 'around',
        status: 'everyone',
        q: 'x',
      },
    });
    assert({
      given: 'filters set and the around-me scope',
      should: 'count one in the phone panel, carry scope and offer Clear',
      actual: [
        field(view, 'scope'),
        shows(view, '1'),
        view.attribute('link', 'Clear', 'href'),
      ],
      expected: ['around', true, '/leaderboard?scope=around'],
    });
  });

  test('the lobby switch and style (YLeaderboard)', () => {
    const youth = render({
      query: { ...defaultQuery, division: 'youth', q: 'x', page: 2 },
      ladder: { style: 'freestyle', division: 'youth' },
    });
    const lobby = youth.within('navigation', 'Lobby');
    const youthText = youth.textContent();
    const youthOpenHref = lobby.attribute('link', 'Open', 'href');
    const youthCurrent = lobby.has('link', 'Youth', { current: 'page' });
    const youthDivision = field(youth, 'division');
    // Rendered last: a view reads labels through the one live document.
    const visitor = render();
    assert({
      given: 'the Youth ladder asked for, and a visitor on the default ladder',
      should:
        'show Open then Youth in a Lobby group with no caption, mark the shown one, link the other keeping the search, carry an asked division and offer Freestyle',
      actual: [
        lobby.names('link'),
        youthText.includes('Division') || youthText.includes('Scope'),
        youthCurrent,
        youthOpenHref,
        youthDivision,
        field(visitor, 'division'),
        visitor
          .within('navigation', 'Lobby')
          .has('link', 'Open', { current: 'page' }),
        visitor
          .within('combobox', 'Style')
          .names('option')
          .includes('Freestyle'),
        visitor.attribute('combobox', 'Style', 'name'),
      ],
      expected: [
        ['Open', 'Youth'],
        false,
        true,
        '/leaderboard?division=open&q=x',
        'youth',
        null,
        true,
        true,
        null,
      ],
    });
  });
});
