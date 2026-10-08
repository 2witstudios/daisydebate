import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { iconPaths } from '../../components/icon/icons';
import { prepGlyphs } from './prep-glyphs';
import { PrepIcon } from './prep-icon';

setupRitewayBun();

describe('PrepIcon', () => {
  test('its own glyphs and the shared set', () => {
    const own = renderToString(h(PrepIcon, { name: 'upload', size: 14 }));
    const shared = renderToString(h(PrepIcon, { name: 'search' }));
    assert({
      given: 'a Prep glyph and a shared icon',
      should: 'draw both as decorative svgs at the requested size',
      actual: [
        own.includes('width="14"') && own.includes('aria-hidden="true"'),
        own.includes('d="M12 16V4"'),
        shared.includes('<circle'),
      ],
      expected: [true, true, true],
    });
  });

  test('no glyph shadows a shared icon', () => {
    assert({
      given: 'the Prep glyph names',
      should: 'not repeat a name in the shared icon set',
      actual: Object.keys(prepGlyphs).filter((name) => name in iconPaths),
      expected: [],
    });
  });
});
