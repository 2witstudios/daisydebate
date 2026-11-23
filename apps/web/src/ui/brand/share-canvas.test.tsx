import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../test-support/rendered/accessible';
import { ShareCanvas, shareFormats } from './share-canvas';

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
        const text = renderAccessible(
          <ShareCanvas format={format} scheme={scheme} />,
        ).textContent();
        assert({
          given: `${format} in ${scheme}`,
          should: 'show the brand and tagline',
          actual: [
            text.includes('Daisy Debate'),
            text.includes('The arena for'),
            text.includes('competitive debate'),
            text.includes('Better arguments. A more thoughtful world.'),
          ],
          expected: [true, true, true, true],
        });
      }
  });
});
