import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { ActionLink } from './action-link';

setupRitewayBun();

describe('ActionLink', () => {
  test('a real link styled as a button', () => {
    const view = renderAccessible(
      h(ActionLink, {
        href: '/lobby',
        variant: 'primary',
        children: 'Open the lobby',
      }),
    );
    assert({
      given: 'a primary action link',
      should: 'render one link named by its children, to the href',
      actual: [
        view.attribute('link', 'Open the lobby', 'href'),
        view.count('link'),
      ],
      expected: ['/lobby', 1],
    });
  });
});
