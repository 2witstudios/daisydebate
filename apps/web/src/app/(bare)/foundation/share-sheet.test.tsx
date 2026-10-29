import { renderToStaticMarkup } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { ShareSheet } from './share-sheet';
import { shareFormats } from '../../../ui/brand/share-canvas';

setupRitewayBun();

test('the screenshot sheet exposes every exact-size export in both schemes', () => {
  const html = renderToStaticMarkup(<ShareSheet />);
  const images = [...html.matchAll(/<img\b[^>]*>/g)].map(([tag]) => tag);
  assert({
    given: 'the gated foundation share sheet',
    should:
      'embed all ten original-size PNGs and link each export without inline styles',
    actual: {
      count: images.length,
      formats: Object.entries(shareFormats).flatMap(
        ([format, { width, height }]) =>
          ['light', 'dark'].map(
            (scheme) =>
              images.some(
                (tag) =>
                  tag.includes(`src="/foundation/share/${format}/${scheme}"`) &&
                  tag.includes(`width="${width}"`) &&
                  tag.includes(`height="${height}"`),
              ) &&
              html.includes(`href="/foundation/share/${format}/${scheme}"`),
          ),
      ),
      inlineStyles: html.includes('style='),
    },
    expected: {
      count: 10,
      formats: Array.from({ length: 10 }, () => true),
      inlineStyles: false,
    },
  });
});
