import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { iconPaths } from './icons';
import { tiles } from '../../dashboard/tiles';

setupRitewayBun();

// IconName is an open string key, so a typo renders an empty <svg> silently.
const shellIcons = [
  'home',
  'swords',
  'trophy',
  'chart',
  'eye',
  'bolt',
  'book',
  'person',
  'dots',
  'quote',
  'bell',
  'search',
  'gem',
  'chevronDown',
  'message',
  'users',
];

describe('icon set', () => {
  test('draws every icon the shell and dashboard reference', () => {
    const names = [...shellIcons, ...tiles.map((tile) => tile.glyph)];
    assert({
      given: 'the icon names used by the sidebar, topbar, panels, and tiles',
      should: 'have drawable shapes for each (no silently empty icons)',
      actual: names.filter(
        (name) =>
          renderToString(h('svg', null, iconPaths[name])) === '<svg></svg>',
      ),
      expected: [],
    });
  });
});
