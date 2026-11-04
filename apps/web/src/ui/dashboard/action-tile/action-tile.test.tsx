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

  test('becomes a menu row on a phone', () => {
    const html = renderToString(h(ActionTile, tile));
    assert({
      given: 'a note on a phone',
      should:
        'lay its icon and title in one straight centred row, without the tagline',
      actual: [
        html.includes('max-narrow:note-menu-row'),
        html.includes('max-narrow:flex-row'),
        html.includes('max-narrow:justify-center'),
        /<p class="[^"]*max-narrow:hidden/.test(html),
      ],
      expected: [true, true, true, true],
    });
  });

  test('keeps only Play coloured in the phone menu', () => {
    const paperOf = (note: ActionTileProps['note']) =>
      renderToString(h(ActionTile, { ...tile, note })).includes(
        'max-narrow:note-paper-menu',
      );
    assert({
      given: 'the three note colours',
      should:
        'give yellow and sage the one menu colour, and leave Play its own',
      actual: [paperOf('yellow'), paperOf('sage'), paperOf('action')],
      expected: [true, true, false],
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
