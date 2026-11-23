import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { CopyLink } from './copy-link';

setupRitewayBun();

describe('CopyLink', () => {
  test('before hydration', () => {
    const view = renderAccessible(h(CopyLink, { path: '/watch/top' }));
    const field = view.get('textbox', 'Link to this page', { hidden: true });
    assert({
      given: 'a server render',
      should:
        'offer a details with the link to copy by hand and no dead Copy button',
      actual: [
        view.count('group', undefined, { hidden: true }),
        field.getAttribute('value'),
        field.hasAttribute('readonly'),
        view.has('button', 'Copy', { hidden: true }),
      ],
      expected: [1, '/watch/top', true, false],
    });
  });
});
