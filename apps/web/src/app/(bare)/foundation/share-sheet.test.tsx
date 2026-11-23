import { assert, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { ShareSheet } from './share-sheet';
import { shareFormats } from '../../../ui/brand/share-canvas';

setupRitewayBun();

test('the screenshot sheet exposes every exact-size export in both schemes', () => {
  const view = renderAccessible(<ShareSheet />);
  const sheet = view.get('region', 'Share images');
  assert({
    given: 'the gated foundation share sheet',
    should:
      'embed all ten original-size PNGs and link each export without inline styles',
    actual: {
      count: view.count('img'),
      formats: Object.entries(shareFormats).flatMap(
        ([format, { width, height, label }]) =>
          ['light', 'dark'].map((scheme) => {
            const section = view.within('region', label);
            const image = section.get(
              'img',
              `${label}, ${scheme}: Daisy Debate. The arena for competitive debate. Better arguments. A more thoughtful world.`,
            );
            return (
              image.getAttribute('src') ===
                `/foundation/share/${format}/${scheme}` &&
              image.getAttribute('width') === String(width) &&
              image.getAttribute('height') === String(height) &&
              section.attribute(
                'link',
                `Open ${scheme} PNG · ${width} × ${height}`,
                'href',
              ) === `/foundation/share/${format}/${scheme}`
            );
          }),
      ),
      inlineStyles:
        sheet.hasAttribute('style') || sheet.querySelector('[style]') !== null,
    },
    expected: {
      count: 10,
      formats: Array.from({ length: 10 }, () => true),
      inlineStyles: false,
    },
  });
});
