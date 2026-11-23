import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../../../test-support/rendered/accessible';
import { AccountMenu } from './account-menu';

setupRitewayBun();

describe('AccountMenu', () => {
  test('a member reaches support from their account menu', () => {
    const view = renderAccessible(
      h(AccountMenu, {
        account: {
          state: 'member',
          username: 'sam',
          displayName: null,
          photoId: null,
        },
        extended: true,
        ratings: null,
      }),
    );
    // The menu's links sit inside a closed disclosure, so out of the tree until opened.
    const links = view
      .all('link', undefined, { hidden: true })
      .map((link) => link.getAttribute('href'));
    const help = links.indexOf('/help');
    assert({
      given: 'a member’s account menu',
      should: 'list Contact support right after Help',
      actual: [
        help === -1 ? null : links[help + 1],
        view
          .all('link', 'Contact support', { hidden: true })
          .map((link) => link.getAttribute('href')),
      ],
      expected: ['/support', ['/support']],
    });
  });
});
