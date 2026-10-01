import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { CopyLink } from './copy-link';

setupRitewayBun();

describe('CopyLink', () => {
  test('before hydration', () => {
    const html = renderToString(h(CopyLink, { path: '/watch/top' }));
    assert({
      given: 'a server render',
      should:
        'offer a details with the link to copy by hand and no dead Copy button',
      actual: [
        html.includes('<details'),
        html.includes('value="/watch/top"'),
        html.includes('readOnly') || html.includes('readonly'),
        html.includes('>Copy<'),
      ],
      expected: [true, true, true, false],
    });
  });
});
