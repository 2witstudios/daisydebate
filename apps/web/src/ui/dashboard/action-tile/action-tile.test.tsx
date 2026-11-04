import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
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
    const html = renderToString(h(ActionTile, tile));
    assert({
      given: 'an action tile',
      should: 'link to its route carrying the copy and an icon',
      actual: [
        html.includes('href="/ranked"'),
        html.includes('Ranked'),
        html.includes('Climb the ladder. Prove yourself.'),
        html.includes('<svg'),
      ],
      expected: [true, true, true, true],
    });
  });

  test('is a note of its colour and tilt, with nothing but its copy', () => {
    const html = renderToString(h(ActionTile, tile));
    assert({
      given: 'a yellow note leaning left',
      should:
        'wear that paper and tilt, with no status, arrow, clamp or icon background',
      actual: [
        html.includes('note-paper-yellow'),
        html.includes('note-tilt-left'),
        html.includes('Open'),
        html.includes('›'),
        html.includes('line-clamp'),
        html.includes('bg-accent-soft'),
      ],
      expected: [true, true, false, false, false, false],
    });
  });

  test('reverses the ink on the emphasised note', () => {
    const html = renderToString(h(ActionTile, { ...tile, note: 'action' }));
    assert({
      given: 'the action note',
      should: 'draw its copy in the accent ink, never the note ink',
      actual: [
        html.includes('text-accent-ink'),
        html.includes('text-note-ink'),
      ],
      expected: [true, false],
    });
  });
});
