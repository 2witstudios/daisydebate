import { assert, setupRitewayBun, test } from 'riteway/bun';
import { ShareSheet } from '../app/(bare)/foundation/share-sheet';
import { renderMarkup } from '../test-support/rendered/markup';

setupRitewayBun();

/**
 * Inline styles have no accessible equivalent: whether the sheet sets any
 * (it must not, so the content security policy needs no style hashes) is
 * carried only by its markup.
 */
test('the share sheet sets no inline styles', () => {
  assert({
    given: 'the gated foundation share sheet',
    should: 'carry no style attribute anywhere',
    actual: /\sstyle="/.test(renderMarkup(<ShareSheet />)),
    expected: false,
  });
});
