import { renderToStaticMarkup } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { ShareCanvas, shareFormats } from './share-canvas';
import { RasterMark } from './raster-mark';
import { bloomPetals } from './petal';
import { markGeometry, petalShape, tileGeometry } from './brand-geometry';

setupRitewayBun();

describe('share surfaces', () => {
  test('renders every platform at its export size in either scheme', () => {
    assert({
      given: 'the five screenshot formats',
      should: 'preserve the exact export dimensions',
      actual: Object.values(shareFormats).map(({ width, height }) => [
        width,
        height,
      ]),
      expected: [
        [1200, 630],
        [1600, 900],
        [1080, 1080],
        [1080, 1920],
        [1280, 720],
      ],
    });
    for (const scheme of ['light', 'dark'] as const)
      for (const format of Object.keys(
        shareFormats,
      ) as (keyof typeof shareFormats)[]) {
        const html = renderToStaticMarkup(
          <ShareCanvas format={format} scheme={scheme} />,
        );
        assert({
          given: `${format} in ${scheme}`,
          should:
            'show the brand, tagline and shared generated geometry without stylesheet dependencies',
          actual: [
            html.includes('Daisy Debate'),
            html.includes('The arena for'),
            html.includes('competitive debate'),
            html.includes('Better arguments. A more thoughtful world.'),
            html.includes(bloomPetals(petalShape, markGeometry)[0]!.d),
            html.includes('class='),
          ],
          expected: [true, true, true, true, true, false],
        });
      }
  });

  test('draws the shipped favicon tile', () => {
    const html = renderToStaticMarkup(<RasterMark size={32} tile />);
    assert({
      given: 'the raster icon renderer',
      should: 'use all eight shipped tile petals and its rounded square',
      actual: [
        bloomPetals(petalShape, markGeometry, tileGeometry.bloomScale).every(
          ({ d }) => html.includes(d),
        ),
        html.includes(`rx="${tileGeometry.cornerRadius}"`),
      ],
      expected: [true, true],
    });
  });
});
