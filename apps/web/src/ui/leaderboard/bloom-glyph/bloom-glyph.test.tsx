import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { BloomGlyph } from './bloom-glyph';
import { bloomPetalShapes } from './bloom-glyph-geometry';

setupRitewayBun();

describe('bloomPetalShapes', () => {
  test('petals fill with the band', () => {
    assert({
      given: 'each band',
      should:
        'fill 2, 4, 6 and 8 of the eight petals and none when provisional',
      actual: (
        ['sprout', 'bud', 'bloom', 'full-bloom', 'provisional'] as const
      ).map(
        (bloom) =>
          bloomPetalShapes(bloom).filter((petal) => petal.filled).length,
      ),
      expected: [2, 4, 6, 8, 0],
    });
  });

  test('geometry', () => {
    const [top, right] = bloomPetalShapes('bloom');
    assert({
      given: 'the first two petals',
      should: 'sit at the top and right of the centre',
      actual: [top, right],
      expected: [
        { cx: 14, cy: 5.8, angle: 0, filled: true },
        { cx: 19.8, cy: 8.2, angle: 45, filled: true },
      ],
    });
  });

  test('sprout fills opposite petals', () => {
    assert({
      given: 'a sprout',
      should: 'fill the top and bottom petals',
      actual: bloomPetalShapes('sprout')
        .filter((petal) => petal.filled)
        .map((petal) => petal.angle),
      expected: [0, 180],
    });
  });
});

describe('BloomGlyph', () => {
  test('a band', () => {
    const html = renderToString(h(BloomGlyph, { bloom: 'bud' }));
    assert({
      given: 'a bud',
      should: 'be decorative with four filled petals and a yolk',
      actual: [
        html.includes('aria-hidden="true"'),
        html.match(/fill-accent/g)?.length,
        html.includes('fill-yolk'),
      ],
      expected: [true, 4, true],
    });
  });

  test('provisional', () => {
    const html = renderToString(
      h(BloomGlyph, { bloom: 'provisional', size: 36 }),
    );
    assert({
      given: 'a provisional marker',
      should: 'draw a dashed ring and no petals',
      actual: [
        html.includes('stroke-dasharray="3 3"'),
        html.includes('<ellipse'),
        html.includes('width="36"'),
      ],
      expected: [true, false, true],
    });
  });
});
