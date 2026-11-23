import { createElement as h } from 'react';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { renderMarkup } from '../test-support/rendered/markup';
import { Notice } from '../ui/auth/notice/notice';

setupRitewayBun();

/**
 * The notice's icon is decorative (`aria-hidden`), so it is outside the
 * accessibility tree and only its markup says it was drawn.
 */
test('an error notice draws its decorative icon', () => {
  const html = renderMarkup(
    h(Notice, { id: 'n', tone: 'error', title: 'Refused.' }),
  );
  assert({
    given: 'an error notice',
    should: 'draw an icon hidden from assistive technology',
    actual: /<svg[^>]*aria-hidden="true"/.test(html),
    expected: true,
  });
});
