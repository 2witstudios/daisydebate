import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { ActionTile } from './action-tile';

setupRitewayBun();

describe('ActionTile', () => {
  test('links to its route with glyph, title, and description', () => {
    const html = renderToString(
      h(ActionTile, {
        href: '/ranked',
        glyph: 'swords',
        title: 'Ranked',
        description: 'Climb the ladder. Prove yourself.',
      }),
    );
    assert({
      given: 'an action tile',
      should: 'link to its route carrying the copy',
      actual: [
        html.includes('href="/ranked"'),
        html.includes('Ranked'),
        html.includes('Climb the ladder. Prove yourself.'),
      ],
      expected: [true, true, true],
    });
  });

  test('renders its status line when provided', () => {
    const withStatus = renderToString(
      h(ActionTile, {
        href: '/ranked',
        glyph: 'swords',
        title: 'Ranked',
        description: 'd',
        status: { tone: 'online', text: '1,248 online' },
      }),
    );
    const withoutStatus = renderToString(
      h(ActionTile, {
        href: '/ranked',
        glyph: 'swords',
        title: 'Ranked',
        description: 'd',
      }),
    );
    assert({
      given: 'tiles with and without a status',
      should: 'render the status text only when provided',
      actual: [
        withStatus.includes('1,248 online'),
        withoutStatus.includes('1,248 online'),
      ],
      expected: [true, false],
    });
  });
});
