import { renderMarkup } from '../test-support/rendered/markup';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { opposingGeometry, petalShape } from '../features/brand/brand-geometry';
import { opposingPetals } from '../features/brand/petal';
import { OpposingPetals } from '../ui/components/daisy-mark/opposing-petals';

setupRitewayBun();

/**
 * The petal pair's drawing is the subject: its geometry and fill classes on
 * a decorative, role-less `<svg>`, so no role, name or state expresses it.
 */

describe('OpposingPetals', () => {
  test('draws the two sides from the opposing-petals geometry, hidden from assistive tech', () => {
    const html = renderMarkup(h(OpposingPetals, { size: 48 }));
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
