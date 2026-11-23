import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../test-support/rendered/accessible';
import NotFound from './not-found';

setupRitewayBun();

describe('NotFound', () => {
  test('offers the way home and a way to contact support', () => {
    const view = renderAccessible(h(NotFound));
    assert({
      given: 'a page that does not exist',
      should: 'link home and to /support',
      actual: [
        view.attribute('link', 'Return home', 'href'),
        view.attribute('link', 'contact support', 'href'),
      ],
      expected: ['/', '/support'],
    });
  });
});
