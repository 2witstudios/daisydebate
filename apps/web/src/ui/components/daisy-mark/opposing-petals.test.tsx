import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { opposingGeometry, petalShape } from '../../brand/brand-geometry';
import { opposingPetals } from '../../brand/petal';
import { OpposingPetals } from './opposing-petals';

setupRitewayBun();

describe('OpposingPetals', () => {
  test('draws the two sides from the opposing-petals geometry, hidden from assistive tech', () => {
    const html = renderToString(h(OpposingPetals, { size: 48 }));
    const [left, right] = opposingPetals(petalShape, {
      centre: [opposingGeometry.width / 2, opposingGeometry.height / 2],
      gap: opposingGeometry.gap,
      tilt: opposingGeometry.tilt,
      scale: opposingGeometry.scale,
    });
    assert({
      given: 'the petal pair',
      should:
        'render a forest left petal and a sage right petal in a 2:1 box, aria-hidden',
      actual: [
        html.includes(`<path d="${left}" class="fill-forest"`),
        html.includes(`<path d="${right}" class="fill-sage"`),
        html.includes('viewBox="0 0 48 24"'),
        html.includes('width="48"'),
        html.includes('height="24"'),
        html.includes('aria-hidden="true"'),
      ],
      expected: [true, true, true, true, true, true],
    });
  });
});
