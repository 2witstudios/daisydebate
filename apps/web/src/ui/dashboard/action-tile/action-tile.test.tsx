import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { ActionTile, type ActionTileProps } from './action-tile';

setupRitewayBun();

const tile: ActionTileProps = {
  href: '/ranked',
  destination: 'lobby',
  title: 'Ranked',
  description: 'Climb the ladder. Prove yourself.',
  note: 'yellow',
  tilt: 'left',
};

describe('ActionTile', () => {
  test('links to its route with glyph, title, and description', () => {
    const view = renderAccessible(h(ActionTile, tile));
    const name = 'Ranked Climb the ladder. Prove yourself.';
    assert({
      given: 'an action tile',
      should:
        'link to its route carrying the copy (its decorative glyph: see markup-contracts)',
      actual: [
        view.attribute('link', name, 'href'),
        view.within('link', name).has('heading', 'Ranked', { level: 2 }),
        view.text('link', name).includes('Climb the ladder. Prove yourself.'),
      ],
      expected: ['/ranked', true, true],
    });
  });
});
