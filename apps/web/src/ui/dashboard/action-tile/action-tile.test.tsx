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
        status: { tone: 'online', text: 'Open' },
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
      actual: [withStatus.includes('Open'), withoutStatus.includes('Open')],
      expected: [true, false],
    });
  });

  test('marks a destination that is not open yet', () => {
    const html = renderToString(
      h(ActionTile, {
        href: '/coming-soon/ranked',
        glyph: 'swords',
        title: 'Ranked',
        description: 'd',
        comingSoon: true,
        status: { tone: 'online', text: 'Open' },
      }),
    );
    assert({
      given: 'a coming-soon tile',
      should:
        'link to the explainer with a Coming soon tag and Learn more, and no status line',
      actual: [
        html.includes('href="/coming-soon/ranked"'),
        html.includes('Coming soon'),
        html.includes('Learn more'),
        html.includes('Open'),
      ],
      expected: [true, true, true, false],
    });
  });

  test('does not tag a launched destination', () => {
    const html = renderToString(
      h(ActionTile, {
        href: '/ranked',
        glyph: 'swords',
        title: 'Ranked',
        description: 'd',
        status: { tone: 'online', text: 'Open' },
      }),
    );
    assert({
      given: 'a launched tile',
      should: 'show neither the tag nor Learn more',
      actual: [html.includes('Coming soon'), html.includes('Learn more')],
      expected: [false, false],
    });
  });
});
