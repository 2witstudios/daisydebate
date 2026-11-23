import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { Segmented } from './segmented';

setupRitewayBun();

describe('Segmented', () => {
  test('links with one current', () => {
    const view = renderAccessible(
      h(Segmented, {
        label: 'Scope',
        segments: [
          { label: 'Top', href: '/leaderboard', selected: true },
          {
            label: 'Around me',
            href: '/leaderboard?scope=around',
            selected: false,
          },
        ],
      }),
    );
    assert({
      given: 'two segments, the first current',
      should: 'render a labelled nav of links marking only the first current',
      actual: [
        view.within('navigation', 'Scope').count('link'),
        view.names('link', { current: 'page' }),
        view.attribute('link', 'Around me', 'href'),
      ],
      expected: [2, ['Top'], '/leaderboard?scope=around'],
    });
  });

  test('no label inside the group', () => {
    const view = renderAccessible(
      h(Segmented, {
        label: 'Lobby',
        segments: [{ label: 'Open lobby', href: '/lobby', selected: true }],
      }),
    );
    assert({
      given: 'a labelled group',
      should: 'name it for assistive technology only, never as visible text',
      actual: [
        view.has('navigation', 'Lobby'),
        view.textContent().includes('Lobby'),
      ],
      expected: [true, false],
    });
  });
});
