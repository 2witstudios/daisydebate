import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderMarkup } from '../test-support/rendered/markup';
import { ShareCanvas, shareFormats } from '../ui/brand/share-canvas';
import { RasterMark } from '../ui/brand/raster-mark';
import { bloomPetals } from '../features/brand/petal';
import {
  markGeometry,
  petalShape,
  tileGeometry,
} from '../features/brand/brand-geometry';

setupRitewayBun();

/**
 * The share surfaces are rasterised to images, so their markup is the
 * product: the shared mark geometry must be drawn inline and nothing may
 * depend on a stylesheet class. Path data and the absence of classes have
 * no role, name or state.
 */
describe('share surfaces markup', () => {
  test('draws the shared geometry without stylesheet dependencies', () => {
    for (const scheme of ['light', 'dark'] as const)
      for (const format of Object.keys(
        shareFormats,
      ) as (keyof typeof shareFormats)[]) {
        const html = renderMarkup(
          <ShareCanvas format={format} scheme={scheme} />,
        );
        assert({
          given: `${format} in ${scheme}`,
          should:
            'draw the shared generated geometry without stylesheet dependencies',
          actual: [
            html.includes(bloomPetals(petalShape, markGeometry)[0]!.d),
            html.includes('class='),
          ],
          expected: [true, false],
        });
      }
  });

  test('draws the shipped favicon tile', () => {
    const html = renderMarkup(<RasterMark size={32} tile />);
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
