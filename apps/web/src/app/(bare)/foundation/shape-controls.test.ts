import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { petalShape } from '../../../ui/brand/brand-geometry';
import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import type { PetalShape } from '../../../ui/brand/petal';
import { DaisyMark } from '../../../ui/components/daisy-mark/daisy-mark';
import { OpposingPetals } from '../../../ui/components/daisy-mark/opposing-petals';
import { shapeControls, tuneShape } from './shape-controls';

setupRitewayBun();

describe('shapeControls', () => {
  test('offers the four petal parameters, each range holding the committed value', () => {
    assert({
      given: 'the brand sheet controls',
      should:
        'cover length, width, bulb position and tip sharpness around the shipped shape',
      actual: shapeControls.map(
        ({ key, min, max }) =>
          `${key}:${min <= petalShape[key] && petalShape[key] <= max}`,
      ),
      expected: ['length:true', 'width:true', 'bulb:true', 'tipSharpness:true'],
    });
  });
});

/** Every coordinate in the rendered paths; a curve stays inside its control points. */
const pathPoints = (html: string) =>
  [...html.matchAll(/ d="([^"]+)"/g)].flatMap(([, d]) => {
    const numbers = (d ?? '').match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    return numbers.flatMap((x, index) =>
      index % 2 === 0 ? [[x, numbers[index + 1] ?? Number.NaN] as const] : [],
    );
  });

describe('shapeControls ranges', () => {
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
        renderToString(h(DaisyMark, { size: 24, variant: 'primary', shape })),
      ).filter(([x, y]) => x < 0 || x > 24 || y < 0 || y > 24);
      const pair = pathPoints(
        renderToString(h(OpposingPetals, { size: 48, shape })),
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

describe('tuneShape', () => {
  test('sets one parameter from a slider value', () => {
    assert({
      given: 'a new width from its slider',
      should: 'change only the width',
      actual: tuneShape(petalShape, 'width', '4'),
      expected: { ...petalShape, width: 4 },
    });
  });

  test('leaves the shape unchanged for a value outside its range or not a number', () => {
    assert({
      given: 'a bulb past its range, a negative length, and junk',
      should: 'return the same shape each time',
      actual: [
        tuneShape(petalShape, 'bulb', '1'),
        tuneShape(petalShape, 'length', '-2'),
        tuneShape(petalShape, 'tipSharpness', 'sharp'),
      ],
      expected: [petalShape, petalShape, petalShape],
    });
  });
});
