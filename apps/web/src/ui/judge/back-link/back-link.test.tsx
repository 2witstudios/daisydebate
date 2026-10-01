import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { BackLink } from './back-link';

setupRitewayBun();

describe('BackLink', () => {
  test('the link home', () => {
    assert({
      given: 'the back link',
      should: 'be a link to the Judge hub',
      actual: /<a [^>]*href="\/judge"/.test(renderToString(h(BackLink))),
      expected: true,
    });
  });
});
