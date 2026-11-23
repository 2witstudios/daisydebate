import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { petalShape } from '../features/brand/brand-geometry';
import type { PetalShape } from '../features/brand/petal';
import { renderMarkup } from '../test-support/rendered/markup';
import { DaisyMark } from '../ui/components/daisy-mark/daisy-mark';
import { OpposingPetals } from '../ui/components/daisy-mark/opposing-petals';
import { shapeControls } from '../app/(bare)/foundation/shape-controls';

setupRitewayBun();

/**
 * The marks are decorative SVG (aria-hidden): whether a petal stays inside
 * its drawing is a property of the path geometry in the markup, with no
 * accessible equivalent.
 */
/** Every coordinate in the rendered paths; a curve stays inside its control points. */
const pathPoints = (html: string) =>
  [...html.matchAll(/ d="([^"]+)"/g)].flatMap(([, d]) => {
    const numbers = (d ?? '').match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    return numbers.flatMap((x, index) =>
      index % 2 === 0 ? [[x, numbers[index + 1] ?? Number.NaN] as const] : [],
    );
  });

describe('shapeControls ranges markup', () => {
  test('keep every preview inside its drawing at every extreme', () => {
    const extremes = shapeControls.reduce<readonly PetalShape[]>(
      (shapes, { key, min, max }) =>
        shapes.flatMap((shape) =>
          [min, max].map((value) => ({ ...shape, [key]: value })),
        ),
      [petalShape],
    );
    const outside = extremes.flatMap((shape) => {
      const mark = pathPoints(
        renderMarkup(h(DaisyMark, { size: 24, variant: 'primary', shape })),
      ).filter(([x, y]) => x < 0 || x > 24 || y < 0 || y > 24);
      const pair = pathPoints(
        renderMarkup(h(OpposingPetals, { size: 48, shape })),
      ).filter(([x, y]) => x < 0 || x > 48 || y < 0 || y > 24);
      return mark.length + pair.length > 0
        ? [`${shape.length}/${shape.width}/${shape.bulb}/${shape.tipSharpness}`]
        : [];
    });
    assert({
      given: 'every combination of slider minimums and maximums',
      should: 'draw the mark and the petal pair without clipping',
      actual: outside,
      expected: [],
    });
  });
});
