import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { defaultQuery } from '../../../features/leaderboard/query';
import {
  field,
  ladder,
} from '../../../features/leaderboard/ladder.test-support';
import {
  renderAccessible,
  type AccessibleView,
} from '../../../test-support/rendered/accessible';
import { LadderTable } from './ladder-table';

setupRitewayBun();

const render = (...args: Parameters<typeof ladder>) => {
  const view = ladder(...args);
  return renderAccessible(
    h(LadderTable, { view, query: { ...defaultQuery, ...args[1] } }),
  );
};

/** The pager's controls that are shown but cannot be followed. */
const disabled = (view: AccessibleView) =>
  view
    .within('navigation', 'Pages')
    .all('generic')
    .filter((element) => element.getAttribute('aria-disabled') === 'true')
    .map((element) => element.textContent);

describe('LadderTable', () => {
  test('first page', () => {
    const view = render(field(40));
    assert({
      given: 'forty debaters on the first page',
      should: 'show the podium, twelve rows, the pager with Next only',
      actual: [
        view.within('list', 'Top three').count('listitem'),
        view.within('region', 'Ladder').count('listitem'),
        view.within('navigation', 'Pages').names('link'),
        view.attribute('link', 'Next', 'href'),
        view.textContent().includes('Page 1 of 3'),
        disabled(view),
      ],
      expected: [3, 12, ['Next'], '/leaderboard?page=2', true, ['Previous']],
    });
  });

  test('last page', () => {
    const view = render(field(40), { page: 3 });
    assert({
      given: 'the last page',
      should: 'link to the previous page and disable Next',
      actual: [
        view.attribute('link', 'Previous', 'href'),
        view.attribute('link', 'Previous', 'rel'),
        view.within('navigation', 'Pages').names('link'),
        disabled(view),
        view.has('list', 'Top three'),
      ],
      expected: ['/leaderboard?page=2', 'prev', ['Previous'], ['Next'], false],
    });
  });

  test('column head depends on the season', () => {
    assert({
      given: 'a live season',
      should: 'head the movement column 7 days',
      actual: render(field(12)).textContent().includes('7 days'),
      expected: true,
    });
  });

  test('empty', () => {
    const view = render(field(12), { q: 'zzz' });
    assert({
      given: 'a search nobody matches',
      should: 'show the empty state with Clear filters and no pager links',
      actual: [
        view.textContent().includes('No matches'),
        view.attribute('link', 'Clear filters', 'href'),
        view.textContent().includes('0 debaters'),
        view.within('navigation', 'Pages').count('link'),
      ],
      expected: [true, '/leaderboard', true, 0],
    });
  });

  test('around me', () => {
    const view = ladder(
      [...field(30)],
      { scope: 'around' },
      { username: 'p010', blinded: [] },
    );
    const rendered = renderAccessible(
      h(LadderTable, { view, query: { ...defaultQuery, scope: 'around' } }),
    );
    assert({
      given: 'the around-me window',
      should: 'show the rank range note and no pager links',
      actual: [
        rendered.textContent().includes('Ranks 6 to 16'),
        rendered.has('navigation', 'Pages'),
      ],
      expected: [true, false],
    });
  });
});
